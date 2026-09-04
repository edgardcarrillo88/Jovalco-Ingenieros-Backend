const UserModel = require('../../../models/seguridad/user');
const { normalizeEmail } = require('../../../services/v1/seguridad/userService');

/**
 * Controlador de gestión de usuarios (tabla User).
 * Permite listar, crear y actualizar usuarios con sus roles por módulo
 * (logistica.esAprobador, equipo.esAprobador, finanzas.rol, admin).
 */

const listUsers = async (req, res) => {
  try {
    const users = await UserModel.find({}).sort({ email: 1 }).lean();
    return res.status(200).json({ success: true, data: users });
  } catch (error) {
    console.error('[user:listUsers]', error.message);
    return res.status(500).json({ success: false, message: 'Error al listar usuarios' });
  }
};

const createUser = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const nombre = String(req.body.nombre || '').trim();

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email requerido' });
    }

    const existente = await UserModel.findOne({ email });
    if (existente) {
      return res.status(409).json({ success: false, message: 'El usuario ya existe' });
    }

    const user = await UserModel.create({
      email,
      nombre,
      activo: req.body.activo !== false,
      admin: Boolean(req.body.admin),
      logistica: {
        esAprobador: Boolean(req.body.logistica?.esAprobador ?? req.body.esAprobadorLogistica),
      },
      equipo: {
        esAprobador: Boolean(req.body.equipo?.esAprobador ?? req.body.esAprobadorEquipo),
      },
      finanzas: {
        rol: String(req.body.finanzas?.rol || req.body.rolFinanzas || '').trim(),
      },
      createdBy: req.user?.email || 'sistema',
    });

    return res.status(201).json({ success: true, data: user });
  } catch (error) {
    console.error('[user:createUser]', error.message);
    return res.status(500).json({ success: false, message: 'Error al crear usuario' });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await UserModel.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const email = req.body.email ? normalizeEmail(req.body.email) : user.email;

    if (req.body.email && email !== user.email) {
      const duplicado = await UserModel.findOne({ email, _id: { $ne: id } });
      if (duplicado) {
        return res.status(409).json({ success: false, message: 'El email ya está en uso por otro usuario' });
      }
    }

    user.email = email;
    if (req.body.nombre !== undefined) user.nombre = String(req.body.nombre || '').trim();
    if (req.body.activo !== undefined) user.activo = Boolean(req.body.activo);
    if (req.body.admin !== undefined) user.admin = Boolean(req.body.admin);

    if (req.body.logistica || req.body.esAprobadorLogistica !== undefined) {
      user.logistica = {
        esAprobador: Boolean(req.body.logistica?.esAprobador ?? req.body.esAprobadorLogistica),
      };
    }
    if (req.body.equipo || req.body.esAprobadorEquipo !== undefined) {
      user.equipo = {
        esAprobador: Boolean(req.body.equipo?.esAprobador ?? req.body.esAprobadorEquipo),
      };
    }
    if (req.body.finanzas || req.body.rolFinanzas !== undefined) {
      user.finanzas = {
        rol: String(req.body.finanzas?.rol || req.body.rolFinanzas || '').trim(),
      };
    }

    user.updatedBy = req.user?.email || 'sistema';
    await user.save();

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('[user:updateUser]', error.message);
    return res.status(500).json({ success: false, message: 'Error al actualizar usuario' });
  }
};

module.exports = { listUsers, createUser, updateUser };
