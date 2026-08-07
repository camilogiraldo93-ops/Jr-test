import { api, ErrorApi } from '../api.js';
import { el, limpiar, modal, campo, entrada, area, selector, exito, error, vacio,
  fmtDinero, fmtFechaCorta, hoyIso } from '../ui.js';

export async function vistaContabilidad({ refrescar }) {
  const consultorios = await api.consultorios();
  const estado = { periodo: 'mes', fecha: hoyIso(), consultorio_id: '' };

  const selPeriodo = selector('periodo', [
    { valor: 'dia', texto: 'Día' }, { valor: 'mes', texto: 'Mes' },
  ], estado.periodo);
  const inFecha = entrada('fecha', { type: 'date', value: estado.fecha });
  const selConsultorio = selector('consultorio_id', [
    { valor: '', texto: 'Todos los consultorios' },
    ...consultorios.map((c) => ({ valor: c.id, texto: c.nombre })),
  ], '');

  const zona = el('div', {});

  /* ------------------------------- Gastos -------------------------------- */
  function abrirGasto() {
    const selCons = selector('consultorio_id',
      consultorios.map((c) => ({ valor: c.id, texto: c.nombre })), selConsultorio.value || consultorios[0]?.id);
    const selCat = selector('categoria', ['insumos', 'nomina', 'alquiler', 'servicios', 'equipos', 'mantenimiento', 'marketing', 'otro']
      .map((c) => ({ valor: c, texto: c })), 'insumos');
    const inConcepto = entrada('concepto', { required: true, placeholder: 'Ej.: Compra de anestesia' });
    const inProveedor = entrada('proveedor', { placeholder: 'Proveedor (opcional)' });
    const inMonto = entrada('monto', { type: 'number', step: '0.01', min: '0.01', required: true });
    const inFechaG = entrada('fecha', { type: 'date', value: inFecha.value || hoyIso() });
    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Registrar gasto' });

    const m = modal({
      titulo: 'Nuevo gasto del consultorio',
      cuerpo: el('div', {}, [
        el('div', { clase: 'fila' }, [campo('Consultorio', selCons), campo('Categoría', selCat)]),
        campo('Concepto *', inConcepto),
        el('div', { clase: 'fila' }, [campo('Proveedor', inProveedor), campo('Monto *', inMonto), campo('Fecha', inFechaG)]),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      if (!inConcepto.value.trim() || !(Number(inMonto.value) > 0)) {
        error('Indica un concepto y un monto mayor que cero.');
        return;
      }
      boton.disabled = true;
      try {
        await api.crearGasto({
          consultorio_id: Number(selCons.value), categoria: selCat.value,
          concepto: inConcepto.value.trim(), proveedor: inProveedor.value.trim(),
          monto: Number(inMonto.value), fecha: inFechaG.value,
        });
        m.cerrar();
        exito('Gasto registrado.');
        await cargar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : 'No se pudo registrar el gasto.');
      } finally { boton.disabled = false; }
    });
  }

  /* -------------------------------- Pagos -------------------------------- */
  async function abrirPago() {
    const pacientes = await api.pacientes();
    if (!pacientes.length) { error('No hay pacientes registrados.'); return; }
    const selPac = selector('paciente_id',
      pacientes.map((p) => ({ valor: p.id, texto: `${p.apellidos}, ${p.nombre}` })), pacientes[0].id);
    const selCargo = selector('cargo_id', [{ valor: '', texto: 'Abono general (sin cargo específico)' }], '');
    const selCons = selector('consultorio_id',
      consultorios.map((c) => ({ valor: c.id, texto: c.nombre })), consultorios[0]?.id);
    const inMonto = entrada('monto', { type: 'number', step: '0.01', min: '0.01', required: true });
    const selMetodo = selector('metodo', ['efectivo', 'tarjeta', 'transferencia', 'seguro', 'otro']
      .map((v) => ({ valor: v, texto: v })), 'efectivo');
    const inNota = entrada('nota', {});
    const info = el('div', { clase: 'mini' });

    async function cargarCargos() {
      const cargos = await api.cargos({ paciente_id: selPac.value });
      const pendientes = cargos.filter((c) => c.saldo > 0);
      limpiar(selCargo);
      selCargo.appendChild(el('option', { value: '', texto: 'Abono general (sin cargo específico)' }));
      for (const c of pendientes) {
        selCargo.appendChild(el('option', {
          value: String(c.id),
          texto: `${fmtFechaCorta(c.fecha)} · ${c.concepto} — saldo ${fmtDinero(c.saldo)}`,
        }));
      }
      const saldo = cargos.reduce((s, c) => s + c.saldo, 0);
      info.textContent = `Saldo total del paciente: ${fmtDinero(saldo)} en ${pendientes.length} cargo(s) pendiente(s).`;
    }
    selPac.addEventListener('change', () => { cargarCargos().catch(() => {}); });
    selCargo.addEventListener('change', () => {
      const op = selCargo.selectedOptions[0];
      const m2 = op?.textContent.match(/saldo \$([\d.,]+)/);
      if (m2) inMonto.value = m2[1].replace(/,/g, '');
    });
    await cargarCargos();

    const boton = el('button', { clase: 'btn', type: 'button', texto: 'Registrar pago' });
    const m = modal({
      titulo: 'Registrar pago de paciente',
      cuerpo: el('div', {}, [
        campo('Paciente', selPac), info,
        campo('Aplicar a', selCargo),
        el('div', { clase: 'fila' }, [campo('Consultorio', selCons), campo('Monto *', inMonto), campo('Método', selMetodo)]),
        campo('Nota', inNota),
      ]),
      pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
    });

    boton.addEventListener('click', async () => {
      if (!(Number(inMonto.value) > 0)) { error('Indica un monto mayor que cero.'); return; }
      boton.disabled = true;
      try {
        await api.crearPago({
          cargo_id: selCargo.value ? Number(selCargo.value) : null,
          paciente_id: Number(selPac.value),
          consultorio_id: Number(selCons.value),
          monto: Number(inMonto.value), metodo: selMetodo.value, nota: inNota.value.trim(),
        });
        m.cerrar();
        exito('Pago registrado.');
        await cargar();
      } catch (err) {
        error(err instanceof ErrorApi ? err.message : 'No se pudo registrar el pago.');
      } finally { boton.disabled = false; }
    });
  }

  /* ------------------------------- Render -------------------------------- */
  async function cargar() {
    const params = {
      periodo: selPeriodo.value, fecha: inFecha.value || hoyIso(),
      consultorio_id: selConsultorio.value || undefined,
    };
    const [bal, gastos, pagos, cargos] = await Promise.all([
      api.balance(params),
      api.gastos({ desde: undefined, hasta: undefined, consultorio_id: params.consultorio_id }),
      api.pagos({ consultorio_id: params.consultorio_id }),
      api.cargos({ consultorio_id: params.consultorio_id }),
    ]);

    const enRango = (f) => f >= bal.desde && f <= bal.hasta;
    const gastosP = gastos.filter((g) => enRango(g.fecha));
    const pagosP = pagos.filter((p) => enRango(p.fecha));
    const deudores = new Map();
    for (const c of cargos) {
      if (c.saldo <= 0) continue;
      const k = c.paciente_id;
      const prev = deudores.get(k) || { nombre: `${c.paciente_apellidos}, ${c.paciente_nombre}`, saldo: 0, id: k };
      prev.saldo += c.saldo;
      deudores.set(k, prev);
    }

    const kpi = (etq, val, pie, clase = '') => el('div', { clase: 'kpi' }, [
      el('div', { clase: 'etq', texto: etq }),
      el('div', { clase: `val ${clase}`, texto: val }),
      pie ? el('div', { clase: 'pie', texto: pie }) : null,
    ]);

    limpiar(zona);
    zona.appendChild(el('div', { clase: 'mini', style: 'margin-bottom:10px',
      texto: `Período: ${fmtFechaCorta(bal.desde)} — ${fmtFechaCorta(bal.hasta)}` }));

    zona.appendChild(el('div', { clase: 'rejilla c4', style: 'margin-bottom:18px' }, [
      kpi('Ingresos (cobrado)', fmtDinero(bal.ingresos), `${bal.conteos.pagos} pago(s)`, 'ok'),
      kpi('Gastos', fmtDinero(bal.gastos), `${bal.conteos.gastos} gasto(s)`, 'mal'),
      kpi('Balance', fmtDinero(bal.balance), 'ingresos − gastos', bal.balance >= 0 ? 'ok' : 'mal'),
      kpi('Por cobrar (histórico)', fmtDinero(bal.cuentas_por_cobrar_total), 'saldo de pacientes'),
    ]));

    zona.appendChild(el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: '🏥 Resumen por consultorio' }),
      el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
        el('thead', {}, [el('tr', {}, ['Consultorio', 'Facturado', 'Ingresos', 'Gastos', 'Balance'].map((t) => el('th', { texto: t })))]),
        el('tbody', {}, bal.por_consultorio.map((c) => el('tr', {}, [
          el('td', { texto: c.nombre }),
          el('td', { clase: 'num', texto: fmtDinero(c.facturado) }),
          el('td', { clase: 'num', texto: fmtDinero(c.ingresos) }),
          el('td', { clase: 'num', texto: fmtDinero(c.gastos) }),
          el('td', { clase: 'num', texto: fmtDinero(c.balance), style: c.balance >= 0 ? 'color:var(--ok)' : 'color:var(--error)' }),
        ]))),
      ])]),
    ]));

    zona.appendChild(el('div', { clase: 'rejilla c2' }, [
      el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: '💵 Pagos del período' }),
        pagosP.length
          ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
              el('thead', {}, [el('tr', {}, ['Fecha', 'Paciente', 'Método', 'Monto'].map((t) => el('th', { texto: t })))]),
              el('tbody', {}, pagosP.map((p) => el('tr', {}, [
                el('td', { texto: fmtFechaCorta(p.fecha) }),
                el('td', {}, [el('a', { href: `#/paciente/${p.paciente_id}`, texto: `${p.paciente_apellidos}, ${p.paciente_nombre}` })]),
                el('td', { texto: p.metodo }),
                el('td', { clase: 'num', texto: fmtDinero(p.monto) }),
              ]))),
            ])])
          : vacio('Sin pagos en el período.'),
      ]),
      el('div', { clase: 'tarjeta' }, [
        el('h3', { texto: '🧾 Gastos del período' }),
        gastosP.length
          ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
              el('thead', {}, [el('tr', {}, ['Fecha', 'Concepto', 'Categoría', 'Monto'].map((t) => el('th', { texto: t })))]),
              el('tbody', {}, gastosP.map((g) => el('tr', {}, [
                el('td', { texto: fmtFechaCorta(g.fecha) }),
                el('td', {}, [el('b', { texto: g.concepto }), el('div', { clase: 'mini', texto: g.consultorio_nombre })]),
                el('td', { texto: g.categoria }),
                el('td', { clase: 'num', texto: fmtDinero(g.monto) }),
              ]))),
            ])])
          : vacio('Sin gastos en el período.'),
      ]),
    ]));

    zona.appendChild(el('div', { clase: 'tarjeta' }, [
      el('h3', { texto: '📌 Pacientes con saldo pendiente' }),
      deudores.size
        ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
            el('thead', {}, [el('tr', {}, ['Paciente', 'Saldo', ''].map((t) => el('th', { texto: t })))]),
            el('tbody', {}, [...deudores.values()].sort((a, b) => b.saldo - a.saldo).map((d) => el('tr', {}, [
              el('td', { texto: d.nombre }),
              el('td', { clase: 'num', texto: fmtDinero(d.saldo) }),
              el('td', {}, [el('a', { clase: 'btn sec chico', href: `#/paciente/${d.id}`, texto: 'Estado de cuenta' })]),
            ]))),
          ])])
        : vacio('Ningún paciente tiene saldo pendiente.'),
    ]));
  }

  [selPeriodo, inFecha, selConsultorio].forEach((c) => c.addEventListener('change', () => {
    cargar().catch((e) => error(e?.message || 'No se pudo cargar la contabilidad.'));
  }));

  const contenedor = el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: 'Contabilidad' }),
        el('div', { clase: 'desc', texto: 'Cobros, gastos, estado de cuenta y balance por consultorio.' }),
      ]),
      el('div', { clase: 'acciones' }, [
        el('button', { clase: 'btn sec', type: 'button', texto: '💵 Registrar pago', onclick: () => { abrirPago().catch((e) => error(e?.message || 'Error')); } }),
        el('button', { clase: 'btn', type: 'button', texto: '🧾 Registrar gasto', onclick: abrirGasto }),
      ]),
    ]),
    el('div', { clase: 'agenda-controles' }, [
      campo('Período', selPeriodo),
      campo('Fecha de referencia', inFecha),
      campo('Consultorio', selConsultorio),
    ]),
    zona,
  ]);

  await cargar();
  return contenedor;
}
