const mongoose = require('mongoose')

const CounterSchema = mongoose.Schema({
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 }
})

module.exports = mongoose.model('comercial_Counter', CounterSchema, 'Comercial_Counter')
