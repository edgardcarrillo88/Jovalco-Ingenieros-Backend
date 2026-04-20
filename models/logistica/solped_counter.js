const mongoose = require('mongoose');

const SolpedCounterSchema = mongoose.Schema({
  name: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('logistica_solped_counter', SolpedCounterSchema, 'Logistica_Solped_Counter');
