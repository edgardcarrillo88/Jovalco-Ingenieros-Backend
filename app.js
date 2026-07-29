const express = require('express')
require('dotenv').config()
const dbconnect = require("./database")
const cors = require('cors')
const app = express()
const compression = require('compression');
const path = require('path')
const ComercialController = require('./routes/v1/comercial/route')
const AdministracionController = require('./routes/v1/administracion/route')
const LogisticaController = require('./routes/v1/logistica/route')
const ProyectosController = require('./routes/v1/proyectos/route')
const EquipoController = require('./routes/v1/equipo/route')
const FinanzasController = require('./routes/v1/finanzas/route')
const AlmacenController = require('./routes/v1/almacen/route')
const SeguridadController = require('./routes/v1/seguridad/route')
const { startRecurrentSolpedCron } = require('./scripts/recurrent-solped-cron')

dbconnect(app)
startRecurrentSolpedCron()

const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    // Requests from Postman/cURL or same-origin server calls may not send Origin header.
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
}));
  
app.use(compression());
app.use(express.json({ limit: '50mb' }))


app.use('/api/v1',ComercialController)
app.use('/api/v1',AdministracionController)
app.use('/api/v1',LogisticaController)
app.use('/api/v1',ProyectosController)
app.use('/api/v1',EquipoController)
app.use('/api/v1',FinanzasController)
app.use('/api/v1',AlmacenController)
app.use('/api/v1',SeguridadController)
// app.use('/api/v2/data',formcontrollerv2)
// app.use('/api/v1/files',filecontroller) 
// app.use('/api/v1/cost',costcontroller) 
// app.use('/api/v1/messages',messagecontroller) 

app.use(express.static(path.join(__dirname,'public')))