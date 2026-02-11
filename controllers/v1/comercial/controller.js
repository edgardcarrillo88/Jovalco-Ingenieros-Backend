const xlsx = require("xlsx");

const ComercialModel = require("../../../models/comercial/comercial");
const ComercialHistoryModel = require("../../../models/comercial/comercial_history");
const ComercialCounterModel = require("../../../models/comercial/comercial_counter");
const ComercialCBSModel = require("../../../models/comercial/comercial_CBS");
const ComercialCBSHistoryModel = require("../../../models/comercial/comercial_CBS_History");
const ClientesModel = require("../../../models/comercial/clientes");
const EspecialidadesModel = require("../../../models/comercial/especialidades");

const LoadSingleData = async (req, res) => {
  console.log("Cargando datos de comercial");
  try {
    const getNextPEP = async () => {
      const year = new Date().getFullYear();
      const counter = await ComercialCounterModel.findOneAndUpdate(
        { name: "PEP" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      );

      return `J.${year}.${String(counter.seq).padStart(3, "0")}/001`;
    };

    req.body.data.PEP = await getNextPEP();
    const PEPGeneral = req.body.data.PEP;
    req.body.data.Estado = "En Elaboración";

    if (req.body.data.CBSLoad.toLowerCase() === "si") {
      req.body.data.Monto = req.body.CBS.filter(
        (item) => item.Nivel === 1,
      )[0].Venta;

      const CodPEP = req.body.CBS.filter((item) => item.Nivel === 1)[0].ElementoPEP;

      req.body.CBS.map((item) => {
        const elementoPEPOriginal = item.ElementoPEP;

        item.Version = 0;
        item.PEP = PEPGeneral;
        item.ElementoPEP = elementoPEPOriginal.replace(CodPEP, PEPGeneral);
        let comercialCBS = new ComercialCBSModel(item);
        let comercialCBSHistory = new ComercialCBSHistoryModel(item);
        comercialCBS.save();
        comercialCBSHistory.save();
      });
      console.log("CBS Cargado");
    } else {
      req.body.data.Monto = 0;
    }

    const comercial = new ComercialModel(req.body.data);
    const comercialHistory = new ComercialHistoryModel(req.body.data);

    comercial.save();
    comercialHistory.save();
    console.log("Datos de propuesta cargado");

    res.status(200).json({ message: "Datos cargados correctamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al cargar los datos" });
  }
};

const GetClientes = async (req, res) => {
  console.log("Obteniendo clientes");
  try {
    const response = await ClientesModel.find();
    res
      .status(200)
      .json({ message: "Datos obtenidos correctamente", data: response });
  } catch (error) {
    console.log(error);
    res.status(500).send("Error al obtener los datos");
  }
};

const GetEspeciialidades = async (req, res) => {
  console.log("Obteniendo Especialidades");
  try {
    const response = await EspecialidadesModel.find();
    res
      .status(200)
      .json({ message: "Datos obtenidos correctamente", data: response });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener los datos" });
  }
};

const GetPropuestas = async (req, res) => {
  try {
    const response = await ComercialModel.find();
    res
      .status(200)
      .json({ message: "Datos obtenidos correctamente", data: response });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener los datos" });
  }
};

const GetPropuestasSingle = async (req, res) => {
  console.log("Obteniendo datos de propuestas");
  console.log(req.query.id);
  try {
    const response = await ComercialModel.findById(req.query.id);
    res
      .status(200)
      .json({ message: "Datos obtenidos correctamente", data: response });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener los datos" });
  }
};

const ProcessCBS = async (req, res) => {
  console.log("procesando el WBS");
  try {
    const bufferData = req.file.buffer;
    const workbook = xlsx.read(bufferData, { type: "buffer" });
    const worksheet = workbook.Sheets["CBS"];

    const excelData = xlsx.utils.sheet_to_json(worksheet).filter((item) => {
      try {
        return !(
          !String(item.PEP || "").trim() &&
          !String(item.Nivel || "").trim() &&
          !String(item.Carga || "").trim() &&
          !String(item.Descripcion || "").trim() &&
          !String(item.Venta || "").trim() &&
          !String(item.Porcentaje_venta || "").trim() &&
          !String(item.Costo || "").trim() &&
          !String(item.Porcentaje_costo || "").trim()
        );
      } catch (error) {
        return true;
      }
    });

    const dataPromises = await Promise.all(
      excelData.map(async (rowData) => {
        try {
          rowData.Errors = [];

          if (String(rowData.PEP).trim === "") {
            rowData.Errors.push("PEP vacio");
          }

          if (String(rowData.Nivel).trim === "") {
            rowData.Errors.push("Nivel vacio");
          }

          if (String(rowData.Carga).trim === "") {
            rowData.Errors.push("Carga vacio");
          }

          if (String(rowData.Descripcion).trim === "") {
            rowData.Errors.push("Descripcion vacio");
          }

          if (String(rowData.Moneda).trim === "") {
            rowData.Errors.push("Moneda vacio");
          }

          if (typeof rowData.Venta !== "number") {
            rowData.Errors.push("Venta no es un numero");
          }

          if (typeof rowData.Porcentaje_venta !== "number") {
            rowData.Errors.push("Porcentaje_venta no es un numero");
          }

          if (typeof rowData.Costo !== "number") {
            rowData.Errors.push("Costo no es un numero");
          }

          if (typeof rowData.Porcentaje_costo !== "number") {
            rowData.Errors.push("Porcentaje_costo no es un numero");
          }

          if (rowData.Errors.length > 0) {
            rowData.Message = rowData.Errors.join(" | ");
          }

          rowData.isValid = rowData.Errors.length === 0;
          return rowData;
        } catch (error) {
          console.log(error);
          console.error("Error al guardar el dato:", error);
          return null;
        }
      }),
    );

    // console.log(".......");
    // console.log(dataPromises);
    // console.log(".......");

    if (dataPromises.filter((item) => item.isValid === false).length > 0) {
      console.log("Se proceso pero no se guardo");
      res.status(200).json({
        message: "Datos procesados",
        datos: dataPromises,
      });
    } else {
      console.log("Datos procesados");
      res.status(200).json({
        message: "Datos procesados",
        datos: dataPromises,
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Error al cargar los datos" });
  }
};

const GetCBS = async (req, res) => {
  console.log("Ejecutando Get CBS");
  try {
    console.log(req.query.id);
    const response = await ComercialModel.findById(req.query.id);
    const PEP = response.PEP;
    const responseCBS = await ComercialCBSModel.find({ PEP });
    res
      .status(200)
      .json({ message: "Datos obtenidos correctamente", data: responseCBS });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al obtener los datos" });
  }
};

const UpdateSingleData = async (req, res) => {
  console.log("Actualizando información");
  console.log(req.body);
  try {
    const { data, CBS } = req.body;
    console.log("iniciando try");
    await ComercialModel.findByIdAndUpdate(data._id, data);
    console.log("siguien el try");
    const history = { ...data };
    delete history._id;
    await ComercialHistoryModel.create(history);
    console.log("siguen el try 2");


    const CodPEP = CBS.find((item) => item.Nivel === 1)?.ElementoPEP;
    console.log(CodPEP);

    if (CBS?.length && CodPEP) {
      console.log("Despues del if");

      await ComercialCBSModel.bulkWrite(
        CBS.map((item) => {

          console.log(data.PEP);
          const nuevoElementoPEP = item.ElementoPEP.replace(CodPEP, data.PEP);

          return {
            updateOne: {
              filter: { ElementoPEP: nuevoElementoPEP },
              update: {
                $set: {
                  ...item,
                  ElementoPEP: nuevoElementoPEP,
                },
              },
              upsert: true,
            },
          };
        }),
      );

      const historyCBS = CBS.map(({ _id, ...rest }) => rest);
      await ComercialCBSHistoryModel.insertMany(historyCBS);
    }

    res.status(200).json({ message: "Datos actualizados correctamente" });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Error al actualizar los datos" });
  }
};

module.exports = {
  LoadSingleData,
  GetClientes,
  GetEspeciialidades,
  GetPropuestas,
  GetPropuestasSingle,
  ProcessCBS,
  GetCBS,
  UpdateSingleData,
};
