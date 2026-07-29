const mongoose = require('mongoose')

const PersonalHistorySchema = mongoose.Schema({
    personalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Personal', required: true },

    // Datos Personales
    nombres: String,
    apellidos: String,
    dni: String,
    fechaNacimiento: Date,
    celular: String,
    direccion: String,

    // Datos Laborales
    cargo: String,
    area: String,
    fechaIngreso: Date,
    tipoContrato: String,
    tiempoContrato: Number,

    // Renovación
    fechaRenovacion: Date,
    tiempoRenovacion: Number,

    // Datos de Categorización
    categoriaPersonal: String,
    puesto: String,

    // Datos de AFP/Seguros
    altaSunat: Boolean,
    afp: String,

    // Tallas
    tallaPantalon: String,
    tallaCamisa: String,
    tallaZapatos: String,

    // Datos Bancarios
    banco: String,
    numeroCuenta: String,
    numeroCuentaInterbancaria: String,

    // Datos de Sueldo
    sueldoPlanilla: Number,
    sueldoRh: Number,
    bonoDestacue: Number,

    // Estado del Contrato
    contratoFirmado: Boolean,
    frecuenciaPago: { type: String, enum: ['mensual', 'quincenal', 'semanal'] },
    fechaVencimiento: Date,

    // Estados
    estado: String,
    deleted: Boolean,
}, {
    timestamps: true,
})

const PersonalHistory = mongoose.model('PersonalHistory', PersonalHistorySchema, 'PersonalHistory')
module.exports = PersonalHistory
