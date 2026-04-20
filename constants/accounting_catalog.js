const ACCOUNTING_CLASSES = [
  { value: 'COST_OF_SALES', label: 'Costo de venta' },
  { value: 'ADMIN_EXPENSE', label: 'Gasto administrativo' },
  { value: 'FINANCIAL_EXPENSE', label: 'Gasto financiero' },
  { value: 'LOAN', label: 'Prestamo' },
  { value: 'OTHER', label: 'Otros' },
];

const ACCOUNTING_CATALOG = {
  COST_OF_SALES: ['Materiales', 'Subcontrata', 'Transporte obra', 'Equipos de obra'],
  ADMIN_EXPENSE: ['Alquiler', 'Asesorias', 'Tercerizacion', 'Servicios basicos', 'Licencias de software'],
  FINANCIAL_EXPENSE: ['Comisiones bancarias', 'Intereses bancarios', 'Gastos de financiamiento'],
  LOAN: ['Prestamo bancario', 'Prestamo terceros'],
  OTHER: ['Otros operativos', 'Otros no operativos'],
};

const LOAN_COMPONENTS = [
  { value: 'NONE', label: 'No aplica' },
  { value: 'CAPITAL', label: 'Capital' },
  { value: 'INTEREST', label: 'Interes' },
];

const DEFAULT_COST_CENTERS = ['Administracion', 'Comercial', 'Logistica', 'Proyectos', 'Operaciones', 'General'];

module.exports = {
  ACCOUNTING_CLASSES,
  ACCOUNTING_CATALOG,
  LOAN_COMPONENTS,
  DEFAULT_COST_CENTERS,
};
