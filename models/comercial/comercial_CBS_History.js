

const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

const ComercialCBSHistorySchema = mongoose.Schema(
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

ComercialCBSHistorySchema.plugin(mongoosePaginate);

const ComercialCBSHistory = mongoose.model("ComercialCBSHistory", ComercialCBSHistorySchema, "ComercialCBSHistory");
module.exports = ComercialCBSHistory;

