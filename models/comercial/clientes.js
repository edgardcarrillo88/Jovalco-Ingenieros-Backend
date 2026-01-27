const mongoose = require('mongoose')

const ClientesSchema = mongoose.Schema({
    Empresa: String,    
    deleted: { type: Boolean, default: false }
},
    {
        timestamps: true
    })


const Clientes = mongoose.model('Clientes', ClientesSchema, 'Clientes')
module.exports = Clientes