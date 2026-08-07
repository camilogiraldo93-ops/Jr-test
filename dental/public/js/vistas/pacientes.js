import { api, ErrorApi } from '../api.js';
import { el, limpiar, modal, campo, entrada, area, selector, exito, error, fmtFechaCorta, vacio, datosFormulario } from '../ui.js';

export function formularioPaciente(paciente = null) {
  const v = (c) => paciente?.[c] ?? '';
  const form = el('form', {}, [
    el('div', { clase: 'fila' }, [
      campo('Nombres *', entrada('nombre', { value: v('nombre'), required: true })),
      campo('Apellidos *', entrada('apellidos', { value: v('apellidos'), required: true })),
    ]),
    el('div', { clase: 'fila' }, [
      campo('Cédula / ID', entrada('cedula', { value: v('cedula') })),
      campo('Teléfono', entrada('telefono', { value: v('telefono') })),
      campo('Correo', entrada('email', { type: 'email', value: v('email') })),
    ]),
    el('div', { clase: 'fila' }, [
      campo('Fecha de nacimiento', entrada('fecha_nacimiento', { type: 'date', value: v('fecha_nacimiento') })),
      campo('Sexo', selector('sexo', [
        { valor: '', texto: '—' }, { valor: 'F', texto: 'Femenino' },
        { valor: 'M', texto: 'Masculino' }, { valor: 'O', texto: 'Otro' },
      ], v('sexo'))),
      campo('Ocupación', entrada('ocupacion', { value: v('ocupacion') })),
    ]),
    campo('Dirección', entrada('direccion', { value: v('direccion') })),
    el('div', { clase: 'fila' }, [
      campo('Contacto de emergencia', entrada('contacto_emergencia', { value: v('contacto_emergencia') })),
      campo('Teléfono de emergencia', entrada('telefono_emergencia', { value: v('telefono_emergencia') })),
    ]),
    el('h4', { texto: 'Historia médica y odontológica', style: 'margin:16px 0 8px;font-size:.95rem' }),
    el('div', { clase: 'fila' }, [
      campo('Alergias', area('alergias', { value: v('alergias'), placeholder: 'Ej.: Penicilina, látex' })),
      campo('Medicamentos actuales', area('medicamentos', { value: v('medicamentos') })),
    ]),
    campo('Antecedentes médicos', area('antecedentes_medicos', { value: v('antecedentes_medicos'), placeholder: 'Diabetes, hipertensión, embarazo, cardiopatías…' })),
    campo('Antecedentes odontológicos', area('antecedentes_odontologicos', { value: v('antecedentes_odontologicos') })),
    campo('Motivo de consulta', entrada('motivo_consulta', { value: v('motivo_consulta') })),
    campo('Notas', area('notas', { value: v('notas') })),
  ]);
  return form;
}

export function abrirFormularioPaciente(paciente, alGuardar) {
  const form = formularioPaciente(paciente);
  const boton = el('button', { clase: 'btn', type: 'button', texto: paciente ? 'Guardar cambios' : 'Crear paciente' });

  const m = modal({
    titulo: paciente ? `Editar ficha de ${paciente.nombre} ${paciente.apellidos}` : 'Nuevo paciente',
    cuerpo: form,
    ancho: true,
    pie: [
      el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }),
      boton,
    ],
  });
  boton.addEventListener('click', () => form.requestSubmit());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      const datos = datosFormulario(form);
      const guardado = paciente
        ? await api.actualizarPaciente(paciente.id, datos)
        : await api.crearPaciente(datos);
      m.cerrar();
      exito(paciente ? 'Ficha actualizada.' : `Paciente ${guardado.nombre} ${guardado.apellidos} creado.`);
      if (alGuardar) await alGuardar(guardado);
    } catch (err) {
      error(err instanceof ErrorApi ? err.message : 'No se pudo guardar el paciente.');
    } finally {
      boton.disabled = false;
      boton.textContent = paciente ? 'Guardar cambios' : 'Crear paciente';
    }
  });
  return m;
}

export async function vistaPacientes({ navegar }) {
  const zona = el('div', {});
  const buscador = entrada('q', { placeholder: 'Buscar por nombre, cédula o teléfono…', type: 'search' });

  async function cargar() {
    const lista = await api.pacientes(buscador.value.trim());
    limpiar(zona);
    if (!lista.length) {
      zona.appendChild(vacio(buscador.value.trim()
        ? `No se encontraron pacientes para "${buscador.value.trim()}".`
        : 'Aún no hay pacientes registrados.'));
      return;
    }
    zona.appendChild(el('div', { clase: 'tabla-envoltura' }, [
      el('table', { clase: 'tabla' }, [
        el('thead', {}, [el('tr', {}, ['Paciente', 'Cédula / ID', 'Teléfono', 'Nacimiento', 'Alergias', ''].map(
          (t) => el('th', { texto: t })))]),
        el('tbody', {}, lista.map((p) => el('tr', {}, [
          el('td', {}, [el('a', { href: `#/paciente/${p.id}`, texto: `${p.apellidos}, ${p.nombre}` })]),
          el('td', { texto: p.cedula || '—' }),
          el('td', { texto: p.telefono || '—' }),
          el('td', { texto: p.fecha_nacimiento ? fmtFechaCorta(p.fecha_nacimiento) : '—' }),
          el('td', { texto: p.alergias || '—' }),
          el('td', {}, [el('a', { clase: 'btn sec chico', href: `#/paciente/${p.id}`, texto: 'Expediente' })]),
        ]))),
      ]),
    ]));
    zona.appendChild(el('div', { clase: 'mini', style: 'margin-top:10px', texto: `${lista.length} paciente(s).` }));
  }

  let temporizador = null;
  buscador.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => { cargar().catch(() => error('No se pudo buscar.')); }, 220);
  });

  const contenedor = el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: 'Pacientes' }),
        el('div', { clase: 'desc', texto: 'Base de datos de expedientes con buscador por nombre, cédula o teléfono.' }),
      ]),
      el('button', {
        clase: 'btn', type: 'button', texto: '➕ Nuevo paciente',
        onclick: () => abrirFormularioPaciente(null, (p) => navegar(`#/paciente/${p.id}`)),
      }),
    ]),
    el('div', { clase: 'tarjeta' }, [
      el('div', { clase: 'buscador' }, [buscador]),
      zona,
    ]),
  ]);

  await cargar();
  return contenedor;
}
