const xlsx = require("xlsx");

const ComercialModel = require("../../../models/comercial/comercial");
const ComercialCounterModel = require("../../../models/comercial/comercial_counter");
const ClientesModel = require("../../../models/comercial/clientes");
const EspecialidadesModel = require("../../../models/comercial/especialidades");

const LoadSingleData = async (req, res) => {
  console.log("Cargando datos de comercial");
  console.log(req.body);
  try {
    const getNextPEP = async () => {
      const year = new Date().getFullYear();
      const counter = await ComercialCounterModel.findOneAndUpdate(
        { name: "PEP" },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      );

      return `P.${year}.${String(counter.seq).padStart(3, "0")}`;
    };

    req.body.PEP = await getNextPEP();
    req.body.Monto = 0;
    req.body.Estado = "En Elaboración";
    const comercial = new ComercialModel(req.body);
    comercial.save();
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

const ProcessWBS = async (req, res) => {
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

    console.log(".......");
    console.log(dataPromises);
    console.log(".......");

    if (dataPromises.filter((item) => item.isValid === false).length > 0) {
      console.log("Se proceso pero no se guardo");
      res.status(200).json({
        message: "Datos procesados",
        datos: dataPromises,
      });
    } else {
      console.log("Guardando en base de datos");
      res.status(200).json({
        message: "Datos procesados",
        datos: dataPromises,
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Error al cargar los datos" });
  }
};

module.exports = {
  LoadSingleData,
  GetClientes,
  GetEspeciialidades,
  GetPropuestas,
  ProcessWBS,
};
