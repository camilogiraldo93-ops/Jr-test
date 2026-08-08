import { get, post, del, ErrorApp } from '../http.js';
import { todos, uno, correr, ahora } from '../db.js';
import { requerido, texto, numero, entero, soloFecha, hoy, redondear } from '../util.js';
import { exigirDinero } from './ajustes.js';

/* -------------------------------- Cargos ------------------------------- */

get('/api/cargos', ({ consulta }) => {
  const filtros = [];
  const params = [];
  for (const clave of ['paciente_id', 'consultorio_id', 'cita_id', 'tratamiento_id']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`c.${clave} = ?`); params.push(v); }
  }
  const desde = consulta.get('desde'); const hasta = consulta.get('hasta');
  if (desde) { filtros.push('c.fecha >= ?'); params.push(soloFecha(desde)); }
  if (hasta) { filtros.push('c.fecha <= ?'); params.push(soloFecha(hasta)); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(
    `SELECT c.*, p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos,
            (SELECT ifnull(SUM(pg.monto),0) FROM pagos pg WHERE pg.cargo_id = c.id) AS pagado
     FROM cargos c JOIN pacientes p ON p.id = c.paciente_id
     ${where} ORDER BY c.fecha DESC, c.id DESC`, params
  ).map((c) => ({ ...c, saldo: redondear(c.monto - c.pagado) }));
});

post('/api/cargos', { roles: ['admin', 'recepcion', 'doctor'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['paciente_id', 'consultorio_id', 'concepto', 'monto']);
  if (!uno('SELECT id FROM pacientes WHERE id = ?', [cuerpo.paciente_id])) {
    throw new ErrorApp(404, 'Paciente no encontrado.');
  }
  if (!uno('SELECT id FROM consultorios WHERE id = ?', [cuerpo.consultorio_id])) {
    throw new ErrorApp(404, 'Consultorio no encontrado.');
  }
  const monto = numero(cuerpo.monto);
  if (monto <= 0) throw new ErrorApp(400, 'El monto del cargo debe ser mayor que cero.');
  const { ultimoId } = correr(
    `INSERT INTO cargos (paciente_id, consultorio_id, cita_id, tratamiento_id, concepto, monto, fecha, creado_en)
     VALUES (?,?,?,?,?,?,?,?)`,
    [entero(cuerpo.paciente_id), entero(cuerpo.consultorio_id), cuerpo.cita_id ?? null,
     cuerpo.tratamiento_id ?? null, texto(cuerpo.concepto), monto, soloFecha(cuerpo.fecha) || hoy(), ahora()]
  );
  return uno('SELECT * FROM cargos WHERE id = ?', [ultimoId]);
});

/* -------------------------------- Pagos -------------------------------- */

get('/api/pagos', ({ consulta }) => {
  const filtros = [];
  const params = [];
  for (const clave of ['paciente_id', 'consultorio_id', 'cargo_id']) {
    const v = consulta.get(clave);
    if (v) { filtros.push(`pg.${clave} = ?`); params.push(v); }
  }
  const desde = consulta.get('desde'); const hasta = consulta.get('hasta');
  if (desde) { filtros.push('pg.fecha >= ?'); params.push(soloFecha(desde)); }
  if (hasta) { filtros.push('pg.fecha <= ?'); params.push(soloFecha(hasta)); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(
    `SELECT pg.*, p.nombre AS paciente_nombre, p.apellidos AS paciente_apellidos
     FROM pagos pg JOIN pacientes p ON p.id = pg.paciente_id
     ${where} ORDER BY pg.fecha DESC, pg.id DESC`, params);
});

post('/api/pagos', { roles: ['admin', 'recepcion'] }, ({ cuerpo }) => {
  requerido(cuerpo, ['monto']);
  const monto = numero(cuerpo.monto);
  if (monto <= 0) throw new ErrorApp(400, 'El monto del pago debe ser mayor que cero.');

  let cargo = null;
  if (cuerpo.cargo_id) {
    cargo = uno('SELECT * FROM cargos WHERE id = ?', [cuerpo.cargo_id]);
    if (!cargo) throw new ErrorApp(404, 'Cargo no encontrado.');
    const pagado = uno('SELECT ifnull(SUM(monto),0) s FROM pagos WHERE cargo_id = ?', [cargo.id]).s;
    const saldo = redondear(cargo.monto - pagado);
    if (monto > saldo + 0.001) {
      throw new ErrorApp(400,
        `Estás cobrando $${monto.toFixed(2)} pero a este paciente solo le faltan $${saldo.toFixed(2)} ` +
        `por pagar de "${cargo.concepto}". Escribe $${saldo.toFixed(2)} o menos.`);
    }
  } else {
    requerido(cuerpo, ['paciente_id', 'consultorio_id']);
  }

  const pacienteId = cargo ? cargo.paciente_id : entero(cuerpo.paciente_id);
  const consultorioId = cargo ? cargo.consultorio_id : entero(cuerpo.consultorio_id);
  if (!uno('SELECT id FROM pacientes WHERE id = ?', [pacienteId])) throw new ErrorApp(404, 'Paciente no encontrado.');
  if (!uno('SELECT id FROM consultorios WHERE id = ?', [consultorioId])) throw new ErrorApp(404, 'Consultorio no encontrado.');

  const metodos = ['efectivo', 'tarjeta', 'transferencia', 'seguro', 'otro'];
  const metodo = texto(cuerpo.metodo, 'efectivo');
  if (!metodos.includes(metodo)) throw new ErrorApp(400, 'Elige de la lista cómo pagó: efectivo, tarjeta, transferencia, seguro u otro.');

  const { ultimoId } = correr(
    `INSERT INTO pagos (cargo_id, paciente_id, consultorio_id, monto, metodo, fecha, nota, creado_en)
     VALUES (?,?,?,?,?,?,?,?)`,
    [cargo?.id ?? null, pacienteId, consultorioId, monto, metodo,
     soloFecha(cuerpo.fecha) || hoy(), texto(cuerpo.nota), ahora()]
  );
  return uno('SELECT * FROM pagos WHERE id = ?', [ultimoId]);
});

/* -------------------------------- Gastos ------------------------------- */

get('/api/gastos', { roles: ['admin', 'recepcion'] }, ({ consulta, usuario }) => {
  exigirDinero(usuario);
  const filtros = [];
  const params = [];
  const cid = consulta.get('consultorio_id');
  if (cid) { filtros.push('g.consultorio_id = ?'); params.push(cid); }
  const desde = consulta.get('desde'); const hasta = consulta.get('hasta');
  if (desde) { filtros.push('g.fecha >= ?'); params.push(soloFecha(desde)); }
  if (hasta) { filtros.push('g.fecha <= ?'); params.push(soloFecha(hasta)); }
  const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
  return todos(
    `SELECT g.*, c.nombre AS consultorio_nombre FROM gastos g
     JOIN consultorios c ON c.id = g.consultorio_id
     ${where} ORDER BY g.fecha DESC, g.id DESC`, params);
});

post('/api/gastos', { roles: ['admin', 'recepcion'] }, ({ cuerpo, usuario }) => {
  exigirDinero(usuario);
  requerido(cuerpo, ['consultorio_id', 'concepto', 'monto']);
  if (!uno('SELECT id FROM consultorios WHERE id = ?', [cuerpo.consultorio_id])) {
    throw new ErrorApp(404, 'Consultorio no encontrado.');
  }
  const monto = numero(cuerpo.monto);
  if (monto <= 0) throw new ErrorApp(400, 'El monto del gasto debe ser mayor que cero.');
  const categorias = ['insumos', 'nomina', 'alquiler', 'servicios', 'equipos', 'mantenimiento', 'marketing', 'otro'];
  const categoria = texto(cuerpo.categoria, 'insumos');
  if (!categorias.includes(categoria)) {
    throw new ErrorApp(400, 'Elige de la lista el tipo de gasto.');
  }
  const { ultimoId } = correr(
    `INSERT INTO gastos (consultorio_id, categoria, concepto, proveedor, monto, fecha, creado_en)
     VALUES (?,?,?,?,?,?,?)`,
    [entero(cuerpo.consultorio_id), categoria, texto(cuerpo.concepto), texto(cuerpo.proveedor),
     monto, soloFecha(cuerpo.fecha) || hoy(), ahora()]
  );
  return uno('SELECT * FROM gastos WHERE id = ?', [ultimoId]);
});

del('/api/gastos/:id', { roles: ['admin', 'recepcion'] }, ({ params, usuario }) => {
  exigirDinero(usuario);
  if (!uno('SELECT id FROM gastos WHERE id = ?', [params.id])) throw new ErrorApp(404, 'Gasto no encontrado.');
  correr('DELETE FROM gastos WHERE id = ?', [params.id]);
  return { ok: true };
});

/* --------------------------- Estado de cuenta -------------------------- */

get('/api/pacientes/:id/estado-cuenta', ({ params }) => {
  const p = uno('SELECT * FROM pacientes WHERE id = ?', [params.id]);
  if (!p) throw new ErrorApp(404, 'Paciente no encontrado.');
  const cargos = todos(
    `SELECT c.*, (SELECT ifnull(SUM(pg.monto),0) FROM pagos pg WHERE pg.cargo_id = c.id) AS pagado
     FROM cargos c WHERE c.paciente_id = ? ORDER BY c.fecha DESC, c.id DESC`, [params.id]
  ).map((c) => ({ ...c, saldo: redondear(c.monto - c.pagado) }));
  const pagos = todos('SELECT * FROM pagos WHERE paciente_id = ? ORDER BY fecha DESC, id DESC', [params.id]);
  const totalCargos = redondear(cargos.reduce((s, c) => s + c.monto, 0));
  const totalPagos = redondear(pagos.reduce((s, c) => s + c.monto, 0));
  return {
    paciente: { id: p.id, nombre: p.nombre, apellidos: p.apellidos, cedula: p.cedula },
    cargos, pagos,
    total_cargos: totalCargos,
    total_pagos: totalPagos,
    saldo: redondear(totalCargos - totalPagos),
  };
});

/* ------------------------------- Balance ------------------------------- */

get('/api/contabilidad/balance', { roles: ['admin', 'recepcion'] }, ({ consulta, usuario }) => {
  exigirDinero(usuario);
  const cid = consulta.get('consultorio_id') || null;
  const periodo = texto(consulta.get('periodo'), 'mes'); // dia | mes | rango
  const fecha = soloFecha(consulta.get('fecha')) || hoy();

  let desde = soloFecha(consulta.get('desde'));
  let hasta = soloFecha(consulta.get('hasta'));
  if (periodo === 'dia') { desde = fecha; hasta = fecha; }
  else if (periodo === 'mes') { desde = `${fecha.slice(0, 7)}-01`; hasta = `${fecha.slice(0, 7)}-31`; }
  if (!desde || !hasta) throw new ErrorApp(400, 'Falta decir de qué fechas quieres el resumen.');

  const filtroC = cid ? 'AND consultorio_id = ?' : '';
  const pc = cid ? [cid] : [];

  const ingresos = uno(
    `SELECT ifnull(SUM(monto),0) total, COUNT(*) n FROM pagos WHERE fecha >= ? AND fecha <= ? ${filtroC}`,
    [desde, hasta, ...pc]);
  const facturado = uno(
    `SELECT ifnull(SUM(monto),0) total, COUNT(*) n FROM cargos WHERE fecha >= ? AND fecha <= ? ${filtroC}`,
    [desde, hasta, ...pc]);
  const gastos = uno(
    `SELECT ifnull(SUM(monto),0) total, COUNT(*) n FROM gastos WHERE fecha >= ? AND fecha <= ? ${filtroC}`,
    [desde, hasta, ...pc]);

  const porCategoria = todos(
    `SELECT categoria, SUM(monto) total FROM gastos WHERE fecha >= ? AND fecha <= ? ${filtroC}
     GROUP BY categoria ORDER BY total DESC`, [desde, hasta, ...pc]);
  const porMetodo = todos(
    `SELECT metodo, SUM(monto) total, COUNT(*) n FROM pagos WHERE fecha >= ? AND fecha <= ? ${filtroC}
     GROUP BY metodo ORDER BY total DESC`, [desde, hasta, ...pc]);

  // Cada pago se atribuye al doctor del tratamiento cobrado; si el cargo no tiene
  // tratamiento se usa el doctor de la cita. Los abonos libres quedan "Sin asignar".
  const porDoctor = todos(
    `SELECT ifnull(d.nombre, 'Sin asignar') AS doctor,
            SUM(pg.monto) AS total, COUNT(*) AS n
     FROM pagos pg
     LEFT JOIN cargos ca ON ca.id = pg.cargo_id
     LEFT JOIN tratamientos tr ON tr.id = ca.tratamiento_id
     LEFT JOIN citas ci ON ci.id = ca.cita_id
     LEFT JOIN doctores d ON d.id = ifnull(tr.doctor_id, ci.doctor_id)
     WHERE pg.fecha >= ? AND pg.fecha <= ? ${cid ? 'AND pg.consultorio_id = ?' : ''}
     GROUP BY doctor ORDER BY total DESC`, [desde, hasta, ...pc]);

  // Producción facturada por doctor en el período (independiente de lo cobrado).
  const produccionPorDoctor = todos(
    `SELECT d.nombre AS doctor, SUM(t.precio) AS total, COUNT(*) AS n
     FROM tratamientos t JOIN doctores d ON d.id = t.doctor_id
     WHERE t.fecha >= ? AND t.fecha <= ? ${cid ? 'AND t.consultorio_id = ?' : ''}
     GROUP BY d.nombre ORDER BY total DESC`, [desde, hasta, ...pc]);

  const porConsultorio = todos(
    `SELECT co.id, co.nombre,
       (SELECT ifnull(SUM(monto),0) FROM pagos WHERE consultorio_id = co.id AND fecha >= ? AND fecha <= ?) AS ingresos,
       (SELECT ifnull(SUM(monto),0) FROM gastos WHERE consultorio_id = co.id AND fecha >= ? AND fecha <= ?) AS gastos,
       (SELECT ifnull(SUM(monto),0) FROM cargos WHERE consultorio_id = co.id AND fecha >= ? AND fecha <= ?) AS facturado
     FROM consultorios co ${cid ? 'WHERE co.id = ?' : ''} ORDER BY co.nombre`,
    [desde, hasta, desde, hasta, desde, hasta, ...pc]
  ).map((c) => ({ ...c, balance: redondear(c.ingresos - c.gastos), por_cobrar: redondear(c.facturado - c.ingresos) }));

  // Saldo histórico por cobrar: todo lo facturado menos todo lo abonado.
  const totalCargosHist = uno(
    `SELECT ifnull(SUM(monto),0) t FROM cargos WHERE 1=1 ${cid ? 'AND consultorio_id = ?' : ''}`, pc).t;
  const totalPagosHist = uno(
    `SELECT ifnull(SUM(monto),0) t FROM pagos WHERE 1=1 ${cid ? 'AND consultorio_id = ?' : ''}`, pc).t;
  const cuentasPorCobrar = { total: totalCargosHist - totalPagosHist };

  return {
    periodo, desde, hasta, consultorio_id: cid ? Number(cid) : null,
    ingresos: redondear(ingresos.total),
    gastos: redondear(gastos.total),
    facturado: redondear(facturado.total),
    balance: redondear(ingresos.total - gastos.total),
    por_cobrar_periodo: redondear(facturado.total - ingresos.total),
    cuentas_por_cobrar_total: redondear(cuentasPorCobrar.total),
    conteos: { pagos: ingresos.n, gastos: gastos.n, cargos: facturado.n },
    gastos_por_categoria: porCategoria,
    ingresos_por_metodo: porMetodo,
    ingresos_por_doctor: porDoctor.map((d) => ({ ...d, total: redondear(d.total) })),
    produccion_por_doctor: produccionPorDoctor.map((d) => ({ ...d, total: redondear(d.total) })),
    por_consultorio: porConsultorio,
  };
});

/* ------------------------------ Resumen -------------------------------- */

get('/api/resumen', ({ consulta }) => {
  const fecha = soloFecha(consulta.get('fecha')) || hoy();
  const mes = fecha.slice(0, 7);
  return {
    fecha,
    consultorios: uno('SELECT COUNT(*) n FROM consultorios WHERE activo = 1').n,
    cubiculos: uno('SELECT COUNT(*) n FROM cubiculos WHERE activo = 1').n,
    doctores: uno('SELECT COUNT(*) n FROM doctores WHERE activo = 1').n,
    pacientes: uno('SELECT COUNT(*) n FROM pacientes').n,
    citas_hoy: uno('SELECT COUNT(*) n FROM citas WHERE substr(inicio,1,10) = ?', [fecha]).n,
    citas_mes: uno('SELECT COUNT(*) n FROM citas WHERE substr(inicio,1,7) = ?', [mes]).n,
    citas_por_estado: todos(
      'SELECT estado, COUNT(*) n FROM citas WHERE substr(inicio,1,7) = ? GROUP BY estado', [mes]),
    recordatorios_pendientes: uno("SELECT COUNT(*) n FROM recordatorios WHERE estado = 'pendiente'").n,
    consentimientos_pendientes: uno("SELECT COUNT(*) n FROM consentimientos WHERE estado = 'pendiente'").n,
    ingresos_mes: redondear(uno('SELECT ifnull(SUM(monto),0) s FROM pagos WHERE substr(fecha,1,7) = ?', [mes]).s),
    gastos_mes: redondear(uno('SELECT ifnull(SUM(monto),0) s FROM gastos WHERE substr(fecha,1,7) = ?', [mes]).s),
  };
});
