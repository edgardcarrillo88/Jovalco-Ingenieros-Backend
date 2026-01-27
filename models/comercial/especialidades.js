const mongoose = require('mongoose')

const EspecialidadSchema = mongoose.Schema({
    Especialidad: String,    
    deleted: { type: Boolean, default: false }
},
    {
        timestamps: true
    })


const Especialidad = mongoose.model('Especialidad', EspecialidadSchema, 'Especialidad')
module.exports = Especialidad