const mongoose = require("mongoose");
const mongoosePaginate = require("mongoose-paginate-v2");

const ComercialHistorySchema = mongoose.Schema(
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
    Version: Number,

    PEP: { type: String },
    Estado: String,
    CBSLoad: String,
    Monto: { type: Number, default: 0 },

    Comentarios: String,

    Moneda: String,
    deleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
);

ComercialHistorySchema.plugin(mongoosePaginate);

const ComercialHistory = mongoose.model(
  "ComercialHistory",
  ComercialHistorySchema,
  "ComercialHistory",
);
module.exports = ComercialHistory;
