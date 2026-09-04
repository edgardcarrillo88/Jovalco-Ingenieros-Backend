const mongoose = require("mongoose");
const xlsx = require("xlsx");
const ComercialModel = require("../../../models/comercial/comercial");
const ComercialHistoryModel = require("../../../models/comercial/comercial_history");
const ComercialCounterModel = require("../../../models/comercial/comercial_counter");
const ComercialCBSModel = require("../../../models/comercial/comercial_CBS");
const ComercialCBSHistoryModel = require("../../../models/comercial/comercial_CBS_History");
const ClientesModel = require("../../../models/comercial/clientes");
const EspecialidadesModel = require("../../../models/comercial/especialidades");
const { ServiceError, notFound, badRequest } = require("./errors");

const ESTADOS_VALIDOS = ["En Elaboración", "Enviado", "Adjudicado", "Desestimado"];
const MONEDAS_VALIDAS = ["PEN", "USD"];

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const normalizeCBSLoad = (value) =>
  value === true || String(value || "").toLowerCase() === "si" ? "Si" : "No";

/**
 * Genera el siguiente PEP secuencial con formato J.<año>.<seq>/001.
 * El contador se incrementa de forma atómica con findOneAndUpdate.
 */
const getNextPEP = async () => {
  const year = new Date().getFullYear();
  const counter = await ComercialCounterModel.findOneAndUpdate(
    { name: "PEP" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  if (!counter) {
    throw new ServiceError("No fue posible generar el siguiente PEP", 500);
  }

  return `J.${year}.${String(counter.seq).padStart(3, "0")}/001`;
};

/**
 * Genera un PEP adicional basado en el PEP raíz existente (J.2026.001/002, ...).
 */
const getNextAdicionalPEP = async (pepRaiz) => {
  if (!pepRaiz || typeof pepRaiz !== "string" || !pepRaiz.includes("/")) {
    throw badRequest("El PEP de origen es inválido");
  }

  const raiz = pepRaiz.split("/")[0];
  const docs = await ComercialModel.find({
    PEP: { $regex: `^${raiz}/` },
  }).select("PEP");

  if (docs.length === 0) {
    return `${raiz}/001`;
  }

  const max = Math.max(
    ...docs.map((d) => {
      const numero = Number(d.PEP.split("/")[1]);
      return Number.isFinite(numero) ? numero : 0;
    }),
  );

  return `${raiz}/${String(max + 1).padStart(3, "0")}`;
};

/**
 * Valida que los datos básicos de una propuesta sean estructuralmente correctos.
 */
const validatePropuestaData = (data) => {
  if (!data || typeof data !== "object") {
    throw badRequest("El cuerpo de la propuesta es obligatorio");
  }

  const required = ["Cliente", "Especialidad", "Descripcion"];
  for (const campo of required) {
    if (!String(data[campo] || "").trim()) {
      throw badRequest(`El campo ${campo} es obligatorio`);
    }
  }

  if (data.Estado && !ESTADOS_VALIDOS.includes(data.Estado)) {
    throw badRequest(`El estado ${data.Estado} no es válido`);
  }

  if (data.Moneda && !MONEDAS_VALIDAS.includes(data.Moneda)) {
    throw badRequest(`La moneda ${data.Moneda} no es válida`);
  }
};

/**
 * Valida y normaliza una fila CBS proveniente del Excel.
 * Retorna la fila con Errors/Message/isValid.
 */
const validateCBSRow = (rowData) => {
  const row = { ...rowData };
  row.Errors = [];

  const camposTexto = ["PEP", "Nivel", "Carga", "Descripcion", "Moneda"];
  for (const campo of camposTexto) {
    if (!String(row[campo] || "").trim()) {
      row.Errors.push(`${campo} vacio`);
    }
  }

  const camposNumero = ["Venta", "Porcentaje_venta", "Costo", "Porcentaje_costo"];
  for (const campo of camposNumero) {
    if (typeof row[campo] !== "number" || Number.isNaN(row[campo])) {
      row.Errors.push(`${campo} no es un numero`);
    }
  }

  if (row.Moneda && !MONEDAS_VALIDAS.includes(String(row.Moneda).toUpperCase())) {
    row.Errors.push("Moneda no valida");
  }

  if (row.Errors.length > 0) {
    row.Message = row.Errors.join(" | ");
  }

  row.isValid = row.Errors.length === 0;
  return row;
};

/**
 * Filtra filas completamente vacías provenientes del Excel.
 */
const isEmptyRow = (item) => {
  const campos = [
    "PEP",
    "Nivel",
    "Carga",
    "Descripcion",
    "Venta",
    "Porcentaje_venta",
    "Costo",
    "Porcentaje_costo",
    "Moneda",
  ];

  return campos.every(
    (campo) => !String(item?.[campo] ?? "").trim(),
  );
};

/**
 * Lee el buffer de un archivo Excel, extrae la hoja "CBS" y la convierte a JSON.
 */
const readCBSWorkbook = (bufferData) => {
  if (!bufferData || !Buffer.isBuffer(bufferData)) {
    throw badRequest("No se recibió un archivo válido");
  }

  const workbook = xlsx.read(bufferData, { type: "buffer" });
  const worksheet = workbook.Sheets["CBS"];

  if (!worksheet) {
    throw badRequest("El archivo no contiene una hoja llamada 'CBS'");
  }

  return xlsx.utils.sheet_to_json(worksheet);
};

/**
 * Procesa el buffer de un archivo Excel CBS y devuelve cada fila validada.
 * No persiste nada en base de datos.
 */
const processCBS = (bufferData) => {
  const rows = readCBSWorkbook(bufferData);
  const filasNoVacias = rows.filter((item) => !isEmptyRow(item));
  return filasNoVacias.map((rowData) => validateCBSRow(rowData));
};

/**
 * Reescribe los ElementoPEP de las filas CBS reemplazando el código original
 * de nivel 1 por el PEP asignado a la propuesta.
 */
const rebuildCBSElementoPEP = (CBS, PEPGeneral) => {
  if (!CBS || !Array.isArray(CBS) || CBS.length === 0) return [];

  const nivel1 = CBS.find((item) => Number(item.Nivel) === 1);
  const CodPEP = nivel1?.ElementoPEP;

  if (!CodPEP) {
    throw badRequest("No se encontró una fila CBS de nivel 1");
  }

  return CBS.map((item) => ({
    ...item,
    PEP: PEPGeneral,
    ElementoPEP: String(item.ElementoPEP).replace(CodPEP, PEPGeneral),
  }));
};

/**
 * Crea una propuesta comercial completa (Comercial + History + CBS + CBSHistory).
 * Flujo:
 *  1. Genera el PEP secuencial.
 *  2. Marca Estado = "En Elaboración".
 *  3. Si CBSLoad es "Si", calcula el Monto desde el CBS nivel 1 y persiste CBS.
 *  4. Persiste Comercial y ComercialHistory.
 */
const createSingleData = async ({ data, CBS }) => {
  validatePropuestaData(data);

  const pepGeneral = await getNextPEP();
  const cbsLoad = normalizeCBSLoad(data.CBSLoad);

  const propuesta = {
    ...data,
    PEP: pepGeneral,
    Estado: data.Estado || "En Elaboración",
    Comentarios: data.Comentarios || "",
    CBSLoad: cbsLoad,
  };

  let cbsGuardado = [];

  if (cbsLoad === "Si") {
    if (!Array.isArray(CBS) || CBS.length === 0) {
      throw badRequest("El CBSLoad es 'Si' pero no se recibieron líneas CBS");
    }

    const cbsConPEP = rebuildCBSElementoPEP(CBS, pepGeneral).map((item) => ({
      ...item,
      Version: 0,
    }));

    const nivel1 = cbsConPEP.find((item) => Number(item.Nivel) === 1);
    if (!nivel1) {
      throw badRequest("No se encontró una fila CBS de nivel 1 para calcular el monto");
    }

    propuesta.Monto = nivel1.Venta;
    propuesta.Moneda = data.Moneda || nivel1.Moneda;

    cbsGuardado = await Promise.all([
      ComercialCBSModel.insertMany(cbsConPEP),
      ComercialCBSHistoryModel.insertMany(cbsConPEP),
    ]);
  } else {
    propuesta.Monto = 0;
  }

  await ComercialModel.create(propuesta);
  await ComercialHistoryModel.create(propuesta);

  return { message: "Datos cargados correctamente", cbsGuardado };
};

/**
 * Actualiza una propuesta comercial existente.
 *  - Actualiza Comercial por _id.
 *  - Guarda copia histórica en ComercialHistory.
 *  - Hace upsert del CBS (reemplazando ElementoPEP por el PEP actual).
 *  - Inserta el histórico del CBS en ComercialCBSHistory.
 */
const updateSingleData = async ({ data, CBS }) => {
  if (!data || !data._id) {
    throw badRequest("El id de la propuesta es obligatorio");
  }

  if (!isValidObjectId(data._id)) {
    throw badRequest("El id de la propuesta no es válido");
  }

  const existente = await ComercialModel.findById(data._id);
  if (!existente) {
    throw notFound("La propuesta no existe");
  }

  validatePropuestaData(data);

  const cbsLoad = normalizeCBSLoad(data.CBSLoad);
  const pepActual = data.PEP || existente.PEP;
  const comentarios = data.Comentarios || "";

  const datosActualizados = {
    ...data,
    PEP: pepActual,
    CBSLoad: cbsLoad,
    Comentarios: comentarios,
  };

  await ComercialModel.findByIdAndUpdate(data._id, datosActualizados, {
    new: true,
    runValidators: true,
  });

  const history = { ...datosActualizados };
  delete history._id;
  await ComercialHistoryModel.create(history);

  if (Array.isArray(CBS) && CBS.length > 0) {
    const nivel1 = CBS.find((item) => Number(item.Nivel) === 1);
    const CodPEP = nivel1?.ElementoPEP;

    if (CodPEP) {
      const cbsNormalizado = CBS.map((item) => ({
        ...item,
        PEP: pepActual,
        ElementoPEP: String(item.ElementoPEP).replace(CodPEP, pepActual),
      }));

      await ComercialCBSModel.bulkWrite(
        cbsNormalizado.map(({ _id, ...rest }) => ({
          updateOne: {
            filter: { ElementoPEP: rest.ElementoPEP },
            update: { $set: rest },
            upsert: true,
          },
        })),
      );

      const historyCBS = cbsNormalizado.map(({ _id, ...rest }) => rest);
      await ComercialCBSHistoryModel.insertMany(historyCBS);
    }
  }

  return { message: "Datos actualizados correctamente" };
};

/**
 * Crea una propuesta "adicional" derivada de un PEP raíz existente.
 */
const createAditionalData = async ({ data }) => {
  validatePropuestaData(data);

  if (!data.PEP || typeof data.PEP !== "string" || !data.PEP.includes("/")) {
    throw badRequest("La propuesta de origen debe tener un PEP válido");
  }

  const pepAdicional = await getNextAdicionalPEP(data.PEP);

  const propuesta = {
    ...data,
    PEP: pepAdicional,
    Estado: data.Estado || "En Elaboración",
    CBSLoad: normalizeCBSLoad(data.CBSLoad),
    Comentarios: data.Comentarios || "",
    Monto: Number.isFinite(data.Monto) ? data.Monto : 0,
    Version: Number.isFinite(data.Version) ? data.Version : 0,
  };

  await ComercialModel.create(propuesta);
  await ComercialHistoryModel.create(propuesta);

  return { message: "Datos cargados correctamente" };
};

/**
 * Lista clientes activos (no eliminados).
 */
const getClientes = async () => {
  return ClientesModel.find({ deleted: { $ne: true } }).lean();
};

/**
 * Lista especialidades activas (no eliminadas).
 */
const getEspecialidades = async () => {
  return EspecialidadesModel.find({ deleted: { $ne: true } }).lean();
};

/**
 * Lista paginada de propuestas con filtros.
 */
const getPropuestas = async ({
  page = 1,
  limit = 10,
  Cliente,
  Especialidad,
  PEP,
  Descripcion,
  CBSLoad,
  Estado,
} = {}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

  const filter = {};

  if (Cliente) filter.Cliente = { $regex: new RegExp(Cliente, "i") };
  if (Especialidad)
    filter.Especialidad = { $regex: new RegExp(Especialidad, "i") };
  if (PEP) filter.PEP = { $regex: new RegExp(PEP, "i") };
  if (Descripcion)
    filter.Descripcion = { $regex: new RegExp(Descripcion, "i") };
  if (CBSLoad) filter.CBSLoad = CBSLoad;
  if (Estado) filter.Estado = Estado;

  const response = await ComercialModel.paginate(filter, {
    page: pageNum,
    limit: limitNum,
    sort: { createdAt: -1 },
  });

  return response;
};

/**
 * Obtiene una propuesta por id. Lanza 400 si el id no es ObjectId válido y 404 si no existe.
 */
const getPropuestaSingle = async (id) => {
  if (!id || !isValidObjectId(id)) {
    throw badRequest("El id de la propuesta no es válido");
  }

  const propuesta = await ComercialModel.findById(id).lean();
  if (!propuesta) {
    throw notFound("La propuesta no existe");
  }

  return propuesta;
};

/**
 * Obtiene el CBS asociado a una propuesta a través de su PEP.
 */
const getCBS = async (id) => {
  const propuesta = await getPropuestaSingle(id);

  const responseCBS = await ComercialCBSModel.find({
    ElementoPEP: { $regex: `^${propuesta.PEP}` },
  }).lean();

  return responseCBS;
};

/**
 * Crea un cliente.
 */
const createCliente = async (body) => {
  if (!body || !String(body.Empresa || "").trim()) {
    throw badRequest("El nombre de la empresa es obligatorio");
  }

  const cliente = await ClientesModel.create(body);
  return cliente;
};

module.exports = {
  ServiceError,
  createSingleData,
  updateSingleData,
  createAditionalData,
  getClientes,
  getEspecialidades,
  getPropuestas,
  getPropuestaSingle,
  getCBS,
  createCliente,
  processCBS,
  readCBSWorkbook,
  rebuildCBSElementoPEP,
  getNextPEP,
  getNextAdicionalPEP,
  validateCBSRow,
  normalizeCBSLoad,
  isEmptyRow,
  ESTADOS_VALIDOS,
  MONEDAS_VALIDAS,
};
