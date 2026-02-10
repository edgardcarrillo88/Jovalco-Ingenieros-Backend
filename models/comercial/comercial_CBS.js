

const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

const ComercialCBSSchema = mongoose.Schema(
  {
    PEP: String,
    ElementoPEP: String,
    Nivel: String,
    Carga: String,
    Descripcion: String,
    Venta: Number,
    Porcentaje_venta: Number,
    Costo: Number,
    Porcentaje_costo: Number,
    Moneda: String,
    Version: Number,
    deleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

ComercialCBSSchema.plugin(mongoosePaginate);

const ComercialCBS = mongoose.model("ComercialCBS", ComercialCBSSchema, "ComercialCBS");
module.exports = ComercialCBS;

