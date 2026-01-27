const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

const ComercialSchema = mongoose.Schema(
  {
    Cliente: String,
    Especialidad: String,
    Descripcion: String,

    FechaInicio: Date,
    FechaRequerida: Date,
    FechaEnvio: Date,

    Usuario: String,
    Cargo: String,
    Celular: String,
    Correo: String,

    PEP: { type: String, unique: true },
    Estado: String,
    CBSLoad: String,
    Monto: Number,
    Moneda: { type: String, default: "PEN" },
    deleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

ComercialSchema.plugin(mongoosePaginate);

const Comercial = mongoose.model("Comercial", ComercialSchema, "Comercial");
module.exports = Comercial;
