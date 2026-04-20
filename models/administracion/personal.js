const mongoose = require('mongoose')

const PersonalSchema = mongoose.Schema({
    // Datos Personales
    nombres: String,
    apellidos: String,
    dni: { type: String, unique: true, sparse: true },
    fechaNacimiento: Date,
    celular: String,
    direccion: String,
    
    // Datos Laborales
    cargo: String,
    area: String,
    fechaIngreso: Date,
    tipoContrato: String,
    tiempoContrato: Number,
    
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
    estado: { type: String, default: 'Activo' },
    
    // Control
    deleted: { type: Boolean, default: false }
},
    {
        timestamps: true
    })

const Personal = mongoose.model('Personal', PersonalSchema, 'Personal')
module.exports = Personal
