import { api, ErrorApi } from '../api.js';
import { el, limpiar, modal, campo, entrada, area, selector, exito, error, fmtFechaCorta, vacio,
  datosFormulario, formularioCompleto, nombreLista, nombreCompleto, plural } from '../ui.js';
import { descargarExcel } from '../exportar.js';

export function formularioPaciente(paciente = null) {
  const v = (c) => paciente?.[c] ?? '';

  // Lo imprescindible para contestar el teléfono: nombre y número. Todo lo
  // demás se puede completar después, cuando la persona llegue al consultorio.
  const esenciales = el('div', {}, [
    el('div', { clase: 'fila' }, [
      campo('Nombres *', entrada('nombre', { value: v('nombre'), required: true, placeholder: 'María' })),
      campo('Apellidos', entrada('apellidos', { value: v('apellidos'), placeholder: 'Si lo sabes' })),
    ]),
    campo('Teléfono *', entrada('telefono', { value: v('telefono'), required: true, placeholder: '099-123-4567' }),
      'Con esto ya puedes agendarle una cita. Lo demás se llena cuando venga.'),
  ]);

  const resto = el('div', { style: 'display:none' }, [
    el('div', { clase: 'fila' }, [
      campo('Cédula', entrada('cedula', { value: v('cedula') })),
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

  const verMas = el('button', {
    clase: 'btn sec chico', type: 'button',
    texto: paciente ? 'Ver todos los datos ▾' : 'Llenar más datos ahora ▾',
    onclick: () => {
      const abierto = resto.style.display !== 'none';
      resto.style.display = abierto ? 'none' : '';
      verMas.textContent = abierto
        ? (paciente ? 'Ver todos los datos ▾' : 'Llenar más datos ahora ▾')
        : 'Ocultar los demás datos ▴';
    },
  });

  // Al editar una ficha existente se muestra todo: ahí sí se viene a completar.
  if (paciente) resto.style.display = '';

  // `novalidate` apaga el globo nativo del navegador: el aviso lo damos nosotros,
  // en español y nombrando el campo que falta.
  return el('form', { novalidate: true }, [esenciales, paciente ? null : verMas, resto]);
}

export function abrirFormularioPaciente(paciente, alGuardar) {
  const form = formularioPaciente(paciente);
  const boton = el('button', { clase: 'btn', type: 'button', texto: paciente ? 'Guardar cambios' : 'Crear paciente' });

  const m = modal({
    titulo: paciente ? `Editar la ficha de ${nombreCompleto(paciente.nombre, paciente.apellidos)}` : 'Nuevo paciente',
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
    if (!formularioCompleto(form)) return;
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      const datos = datosFormulario(form);
      const guardado = paciente
        ? await api.actualizarPaciente(paciente.id, datos)
        : await api.crearPaciente(datos);
      m.cerrar();
      exito(paciente
        ? 'Listo, la ficha quedó actualizada.'
        : `Listo, ${nombreCompleto(guardado.nombre, guardado.apellidos)} ya está en la lista de pacientes.`);
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
  let visibles = [];

  const btnExcel = el('button', {
    clase: 'btn sec', type: 'button', texto: '⬇️ Exportar a Excel',
    onclick: () => descargarExcel('pacientes.csv',
      ['Apellidos', 'Nombres', 'Cédula', 'Teléfono', 'Correo', 'Nacimiento', 'Alergias'],
      visibles.map((p) => [p.apellidos, p.nombre, p.cedula || '', p.telefono || '',
        p.email || '', p.fecha_nacimiento || '', p.alergias || ''])),
  });

  async function cargar() {
    const lista = await api.pacientes(buscador.value.trim());
    visibles = lista;
    limpiar(zona);
    if (!lista.length) {
      zona.appendChild(vacio(buscador.value.trim()
        ? `No se encontraron pacientes para "${buscador.value.trim()}".`
        : 'Aún no hay pacientes registrados.'));
      return;
    }
    zona.appendChild(el('div', { clase: 'tabla-envoltura' }, [
      el('table', { clase: 'tabla' }, [
        el('thead', {}, [el('tr', {}, ['Paciente', 'Cédula', 'Teléfono', 'Nacimiento', 'Alergias', ''].map(
          (t) => el('th', { texto: t })))]),
        el('tbody', {}, lista.map((p) => el('tr', {}, [
          el('td', {}, [el('a', { href: `#/paciente/${p.id}`, texto: nombreLista(p.nombre, p.apellidos) })]),
          el('td', { texto: p.cedula || '—' }),
          el('td', { texto: p.telefono || '—' }),
          el('td', { texto: p.fecha_nacimiento ? fmtFechaCorta(p.fecha_nacimiento) : '—' }),
          el('td', { texto: p.alergias || '—' }),
          el('td', {}, [el('a', { clase: 'btn sec chico', href: `#/paciente/${p.id}`, texto: 'Expediente' })]),
        ]))),
      ]),
    ]));
    zona.appendChild(el('div', { clase: 'mini', style: 'margin-top:10px', texto: `${plural(lista.length, 'paciente', 'pacientes')}.` }));
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
        el('div', { clase: 'desc', texto: 'Todas las personas que atiende el consultorio. Busca por nombre, cédula o teléfono.' }),
      ]),
      el('div', { clase: 'acciones' }, [
        btnExcel,
        el('button', {
          clase: 'btn', type: 'button', texto: '➕ Nuevo paciente',
          onclick: () => abrirFormularioPaciente(null, (p) => navegar(`#/paciente/${p.id}`)),
        }),
      ]),
    ]),
    el('div', { clase: 'tarjeta' }, [
      el('div', { clase: 'buscador' }, [buscador]),
      zona,
    ]),
  ]);

  await cargar();
  return contenedor;
}
