const comercialService = require("../../../services/v1/comercial/service");
const { ServiceError } = require("../../../services/v1/comercial/errors");

/**
 * Convierte errores de servicio (ServiceError) en respuestas HTTP.
 * Los errores inesperados se registran y responden 500.
 */
const handleServiceError = (res, error, fallbackMessage) => {
  if (error instanceof ServiceError) {
    return res.status(error.status).json({ message: error.message });
  }
  console.error(error);
  return res.status(500).json({ message: fallbackMessage });
};

const LoadSingleData = async (req, res) => {
  try {
    const result = await comercialService.createSingleData({
      data: req.body?.data,
      CBS: req.body?.CBS,
    });
    res.status(200).json({ message: result.message });
  } catch (error) {
    handleServiceError(res, error, "Error al cargar los datos");
  }
};

const GetClientes = async (req, res) => {
  try {
    const data = await comercialService.getClientes();
    res.status(200).json({ message: "Datos obtenidos correctamente", data });
  } catch (error) {
    handleServiceError(res, error, "Error al obtener los datos");
  }
};

const GetEspeciialidades = async (req, res) => {
  try {
    const data = await comercialService.getEspecialidades();
    res.status(200).json({ message: "Datos obtenidos correctamente", data });
  } catch (error) {
    handleServiceError(res, error, "Error al obtener los datos");
  }
};

const GetPropuestas = async (req, res) => {
  try {
    const data = await comercialService.getPropuestas(req.query);
    res.status(200).json({ message: "Datos obtenidos correctamente", data });
  } catch (error) {
    handleServiceError(res, error, "Error al obtener los datos");
  }
};

const GetPropuestasSingle = async (req, res) => {
  try {
    const data = await comercialService.getPropuestaSingle(req.query.id);
    res.status(200).json({ message: "Datos obtenidos correctamente", data });
  } catch (error) {
    handleServiceError(res, error, "Error al obtener los datos");
  }
};

const ProcessCBS = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ message: "No se recibió ningún archivo para procesar" });
    }

    const datos = await comercialService.processCBS(req.file.buffer);
    res.status(200).json({ message: "Datos procesados", datos });
  } catch (error) {
    handleServiceError(res, error, "Error al cargar los datos");
  }
};

const GetCBS = async (req, res) => {
  try {
    const data = await comercialService.getCBS(req.query.id);
    res.status(200).json({ message: "Datos obtenidos correctamente", data });
  } catch (error) {
    handleServiceError(res, error, "Error al obtener los datos");
  }
};

const UpdateSingleData = async (req, res) => {
  try {
    const result = await comercialService.updateSingleData({
      data: req.body?.data,
      CBS: req.body?.CBS,
    });
    res.status(200).json({ message: result.message });
  } catch (error) {
    handleServiceError(res, error, "Error al actualizar los datos");
  }
};

const CreateAditionalData = async (req, res) => {
  try {
    const result = await comercialService.createAditionalData({
      data: req.body?.data,
    });
    res.status(200).json({ message: result.message });
  } catch (error) {
    handleServiceError(res, error, "Error al cargar los datos");
  }
};

const CreateClient = async (req, res) => {
  try {
    await comercialService.createCliente(req.body);
    res.status(200).json({ message: "Cliente creado correctamente" });
  } catch (error) {
    handleServiceError(res, error, "Error al crear el cliente");
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
  CreateAditionalData,
  CreateClient,
};
