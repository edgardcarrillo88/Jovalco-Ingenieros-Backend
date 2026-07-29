const PersonalModel = require('../../../models/administracion/personal');
const PersonalHistoryModel = require('../../../models/administracion/personal_history');
const mongoose = require('mongoose');

const ALLOWED_FIELDS = [
    'nombres',
    'apellidos',
    'dni',
    'fechaNacimiento',
    'celular',
    'direccion',
    'cargo',
    'area',
    'fechaIngreso',
    'tipoContrato',
    'tiempoContrato',
    'fechaRenovacion',
    'tiempoRenovacion',
    'categoriaPersonal',
    'puesto',
    'altaSunat',
    'afp',
    'tallaPantalon',
    'tallaCamisa',
    'tallaZapatos',
    'banco',
    'numeroCuenta',
    'numeroCuentaInterbancaria',
    'sueldoPlanilla',
    'sueldoRh',
    'bonoDestacue',
    'contratoFirmado',
    'frecuenciaPago',
    'fechaVencimiento',
    'estado'
];

const normalizeBodyData = (body = {}) => {
    const source = body && body.data && typeof body.data === 'object' ? body.data : body;
    return ALLOWED_FIELDS.reduce((acc, key) => {
        if (source[key] !== undefined) {
            acc[key] = source[key];
        }
        return acc;
    }, {});
};

const normalizeDni = (dni) => String(dni || '').trim();

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Obtener todos los registros de personal
 * @route GET /administracion/getpersonal
 * @returns {Array} Lista de personal activo
 */
const GetPersonal = async (req, res) => {
    try {
        console.log('[GetPersonal] Obteniendo lista de personal...');
        
        const personal = await PersonalModel.find({ deleted: false })
            .sort({ createdAt: -1 })
            .lean();
        
        console.log(`[GetPersonal] Se encontraron ${personal.length} registros de personal`);
        
        return res.status(200).json({
            success: true,
            message: 'Personal obtenido correctamente',
            data: personal
        });
    } catch (error) {
        console.error('[GetPersonal] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al obtener personal',
            error: error.message
        });
    }
};

/**
 * Obtener un registro de personal específico por ID
 * @route GET /administracion/getpersonal/:id
 * @param {String} id - ID del personal
 * @returns {Object} Registro de personal
 */
const GetPersonalById = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[GetPersonalById] Obteniendo personal con ID: ${id}`);

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID de personal inválido'
            });
        }
        
        const personal = await PersonalModel.findOne({ _id: id, deleted: false }).lean();
        
        if (!personal) {
            return res.status(404).json({
                success: false,
                message: 'Personal no encontrado'
            });
        }
        
        return res.status(200).json({
            success: true,
            message: 'Personal obtenido correctamente',
            data: personal
        });
    } catch (error) {
        console.error('[GetPersonalById] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al obtener personal'
        });
    }
};

/**
 * Agregar un nuevo registro de personal
 * @route POST /administracion/createpersonal
 * @body {Object} Datos del nuevo personal
 * @returns {Object} Personal creado
 */
const CreatePersonal = async (req, res) => {
    try {
        console.log('[CreatePersonal] Creando nuevo registro de personal');
        console.log('[CreatePersonal] Datos recibidos:', JSON.stringify(req.body, null, 2));

        const data = normalizeBodyData(req.body);
        const dni = normalizeDni(data.dni);

        if (!dni) {
            return res.status(400).json({
                success: false,
                message: 'El DNI es obligatorio'
            });
        }
        
        // Validar que no exista un personal con el mismo DNI
        const personalExistente = await PersonalModel.findOne({ 
            dni,
            deleted: false 
        });
        
        if (personalExistente) {
            console.warn('[CreatePersonal] DNI ya existe en la base de datos');
            return res.status(400).json({
                success: false,
                message: 'Ya existe un personal con este DNI'
            });
        }
        
        // Crear nuevo documento
        const nuevoPersonal = new PersonalModel({
            ...data,
            dni,
            estado: data.estado || 'Activo'
        });
        
        // Guardar en la base de datos
        const personalGuardado = await nuevoPersonal.save();
        
        console.log('[CreatePersonal] Personal creado exitosamente con ID:', personalGuardado._id);
        
        return res.status(201).json({
            success: true,
            message: 'Personal creado correctamente',
            data: personalGuardado
        });
    } catch (error) {
        console.error('[CreatePersonal] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al crear personal'
        });
    }
};

/**
 * Actualizar un registro de personal existente
 * @route PUT /administracion/updatepersonal/:id
 * @param {String} id - ID del personal
 * @body {Object} Datos a actualizar
 * @returns {Object} Personal actualizado
 */
const UpdatePersonal = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[UpdatePersonal] Actualizando personal con ID: ${id}`);
        console.log('[UpdatePersonal] Datos a actualizar:', JSON.stringify(req.body, null, 2));

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID de personal inválido'
            });
        }

        const updateData = normalizeBodyData(req.body);
        const dni = normalizeDni(updateData.dni);
        
        // Validar que existe el personal
        const personalExistente = await PersonalModel.findOne({ _id: id, deleted: false });
        
        if (!personalExistente) {
            console.warn(`[UpdatePersonal] Personal con ID ${id} no encontrado`);
            return res.status(404).json({
                success: false,
                message: 'Personal no encontrado'
            });
        }
        
        // Si se intenta cambiar el DNI, validar que no exista otro con ese DNI
        if (dni && dni !== personalExistente.dni) {
            const personalConDniDuplicado = await PersonalModel.findOne({ 
                dni,
                deleted: false,
                _id: { $ne: id }
            });
            
            if (personalConDniDuplicado) {
                console.warn('[UpdatePersonal] DNI ya existe en la base de datos');
                return res.status(400).json({
                    success: false,
                    message: 'Ya existe otro personal con este DNI'
                });
            }
        }
        
        // Actualizar el registro
        const personalActualizado = await PersonalModel.findByIdAndUpdate(
            id,
            { ...updateData, ...(dni ? { dni } : {}) },
            { new: true, runValidators: true }
        );
        
        if (personalActualizado) {
            const historyData = personalActualizado.toObject();
            delete historyData._id;
            historyData.personalId = personalActualizado._id;
            await PersonalHistoryModel.create(historyData);
        }
        
        console.log('[UpdatePersonal] Personal actualizado exitosamente');
        
        return res.status(200).json({
            success: true,
            message: 'Personal actualizado correctamente',
            data: personalActualizado
        });
    } catch (error) {
        console.error('[UpdatePersonal] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al actualizar personal'
        });
    }
};

/**
 * Eliminar (soft delete) un registro de personal
 * @route DELETE /administracion/deletepersonal/:id
 * @param {String} id - ID del personal
 * @returns {Object} Confirmación de eliminación
 */
const DeletePersonal = async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[DeletePersonal] Eliminando personal con ID: ${id}`);

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'ID de personal inválido'
            });
        }
        
        const personalEliminado = await PersonalModel.findByIdAndUpdate(
            id,
            { deleted: true },
            { new: true }
        );
        
        if (!personalEliminado) {
            console.warn(`[DeletePersonal] Personal con ID ${id} no encontrado`);
            return res.status(404).json({
                success: false,
                message: 'Personal no encontrado'
            });
        }
        
        console.log('[DeletePersonal] Personal eliminado exitosamente');
        
        return res.status(200).json({
            success: true,
            message: 'Personal eliminado correctamente',
            data: personalEliminado
        });
    } catch (error) {
        console.error('[DeletePersonal] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al eliminar personal'
        });
    }
};

/**
 * Obtener estadísticas de personal
 * @route GET /administracion/getestadisticas
 * @returns {Object} Estadísticas generales del personal
 */
const GetEstadisticas = async (req, res) => {
    try {
        console.log('[GetEstadisticas] Obteniendo estadísticas de personal...');
        
        const totalPersonal = await PersonalModel.countDocuments({ deleted: false });
        
        const personalPorArea = await PersonalModel.aggregate([
            { $match: { deleted: false } },
            { $group: { _id: '$area', cantidad: { $sum: 1 } } },
            { $sort: { cantidad: -1 } }
        ]);
        
        const personalPorCargo = await PersonalModel.aggregate([
            { $match: { deleted: false } },
            { $group: { _id: '$cargo', cantidad: { $sum: 1 } } },
            { $sort: { cantidad: -1 } }
        ]);
        
        const personalPorEstado = await PersonalModel.aggregate([
            { $match: { deleted: false } },
            { $group: { _id: '$estado', cantidad: { $sum: 1 } } }
        ]);
        
        console.log('[GetEstadisticas] Estadísticas obtenidas correctamente');
        
        return res.status(200).json({
            success: true,
            message: 'Estadísticas obtenidas correctamente',
            data: {
                totalPersonal,
                personalPorArea,
                personalPorCargo,
                personalPorEstado
            }
        });
    } catch (error) {
        console.error('[GetEstadisticas] Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al obtener estadísticas'
        });
    }
};

module.exports = {
    GetPersonal,
    GetPersonalById,
    CreatePersonal,
    UpdatePersonal,
    DeletePersonal,
    GetEstadisticas
};
