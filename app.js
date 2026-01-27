const express = require('express')
require('dotenv').config()
const dbconnect = require("./database")
const cors = require('cors')
const app = express()
const compression = require('compression');
const path = require('path')
const ComercialController = require('./routes/v1/comercial/route')

dbconnect(app)

app.use(cors({
  origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  }));
  
app.use(compression());
app.use(express.json({ limit: '50mb' }))


app.use('/api/v1',ComercialController)
// app.use('/api/v2/data',formcontrollerv2)
// app.use('/api/v1/files',filecontroller) 
// app.use('/api/v1/cost',costcontroller) 
// app.use('/api/v1/messages',messagecontroller) 

app.use(express.static(path.join(__dirname,'public')))