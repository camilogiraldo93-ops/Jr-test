import { api, ErrorApi } from '../api.js';
import { el, modal, campo, entrada, area, selector, exito, error, vacio, fmtDinero , NOMBRE_ROL } from '../ui.js';

function formModal({ titulo, campos, alGuardar, textoBoton = 'Guardar' }) {
  const boton = el('button', { clase: 'btn', type: 'button', texto: textoBoton });
  const m = modal({
    titulo,
    cuerpo: el('div', {}, campos.map((c) => c.nodo)),
    pie: [el('button', { clase: 'btn sec', type: 'button', texto: 'Cancelar', onclick: () => m.cerrar() }), boton],
  });
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    boton.textContent = 'Guardando…';
    try {
      await alGuardar();
      m.cerrar();
    } catch (err) {
      error(err instanceof ErrorApi ? err.message : 'No se pudo guardar.');
    } finally {
      boton.disabled = false;
      boton.textContent = textoBoton;
    }
  });
  return m;
}

export async function vistaConfiguracion({ refrescar }) {
  const [consultorios, doctores, catalogo, usuarios] = await Promise.all([
    api.consultorios(), api.doctores(), api.catalogo(), api.usuarios(),
  ]);

  /* ----------------------------- Consultorios ---------------------------- */
  function nuevoConsultorio() {
    const nombre = entrada('nombre', { required: true, placeholder: 'Ej.: Clínica Dental Sur' });
    const direccion = entrada('direccion', {});
    const telefono = entrada('telefono', {});
    const ciudad = entrada('ciudad', {});
    formModal({
      titulo: 'Nuevo consultorio (sede)',
      campos: [
        { nodo: campo('Nombre *', nombre) },
        { nodo: campo('Dirección', direccion) },
        { nodo: el('div', { clase: 'fila' }, [campo('Teléfono', telefono), campo('Ciudad', ciudad)]) },
      ],
      alGuardar: async () => {
        if (!nombre.value.trim()) throw new ErrorApi(400, 'El nombre es obligatorio.');
        await api.crearConsultorio({
          nombre: nombre.value.trim(), direccion: direccion.value.trim(),
          telefono: telefono.value.trim(), ciudad: ciudad.value.trim(),
        });
        exito('Consultorio creado.');
        await refrescar();
      },
      textoBoton: 'Crear consultorio',
    });
  }

  function nuevoCubiculo(consultorioId) {
    const nombre = entrada('nombre', { required: true, placeholder: 'Ej.: Cubículo 4' });
    const descripcion = entrada('descripcion', { placeholder: 'Equipamiento del cubículo' });
    const selCons = selector('consultorio_id',
      consultorios.map((c) => ({ valor: c.id, texto: c.nombre })), consultorioId ?? consultorios[0]?.id);
    formModal({
      titulo: 'Nuevo cubículo',
      campos: [
        { nodo: campo('Consultorio', selCons) },
        { nodo: campo('Nombre *', nombre) },
        { nodo: campo('Descripción', descripcion) },
      ],
      alGuardar: async () => {
        if (!nombre.value.trim()) throw new ErrorApi(400, 'El nombre es obligatorio.');
        await api.crearCubiculo({
          consultorio_id: Number(selCons.value), nombre: nombre.value.trim(),
          descripcion: descripcion.value.trim(),
        });
        exito('Cubículo creado.');
        await refrescar();
      },
      textoBoton: 'Crear cubículo',
    });
  }

  /* -------------------------------- Doctores ----------------------------- */
  function formDoctor(doctor = null) {
    const nombre = entrada('nombre', { required: true, value: doctor?.nombre || '', placeholder: 'Dr(a). Nombre Apellido' });
    const cedula = entrada('cedula', { value: doctor?.cedula || '' });
    const especialidad = entrada('especialidad', { value: doctor?.especialidad || '' });
    const telefono = entrada('telefono', { value: doctor?.telefono || '' });
    const email = entrada('email', { type: 'email', value: doctor?.email || '' });
    const color = entrada('color', { type: 'color', value: doctor?.color || '#0ea5e9' });

    const asignados = new Set((doctor?.cubiculos || []).map((c) => c.id));
    const casillas = [];
    const bloques = consultorios.map((co) => el('div', { style: 'margin-bottom:10px' }, [
      el('b', { texto: co.nombre }),
      el('div', {}, co.cubiculos.map((cu) => {
        const chk = el('input', { type: 'checkbox', value: String(cu.id) });
        chk.checked = asignados.has(cu.id);
        casillas.push(chk);
        return el('label', { style: 'display:flex;gap:8px;align-items:center;padding:3px 0' }, [
          chk, el('span', { texto: cu.nombre }),
        ]);
      })),
    ]));

    formModal({
      titulo: doctor ? `Editar ${doctor.nombre}` : 'Nuevo doctor',
      campos: [
        { nodo: campo('Nombre *', nombre) },
        { nodo: el('div', { clase: 'fila' }, [campo('Cédula', cedula), campo('Especialidad', especialidad)]) },
        { nodo: el('div', { clase: 'fila' }, [campo('Teléfono', telefono), campo('Correo', email), campo('Color en agenda', color)]) },
        { nodo: el('div', { clase: 'campo' }, [
            el('label', { texto: 'Cubículos asignados' }),
            el('div', { style: 'max-height:240px;overflow:auto;border:1px solid var(--borde);border-radius:9px;padding:10px' }, bloques),
            el('div', { clase: 'ayuda', texto: 'El consultorio se asigna automáticamente al marcar sus cubículos.' }),
          ]) },
      ],
      alGuardar: async () => {
        if (!nombre.value.trim()) throw new ErrorApi(400, 'El nombre es obligatorio.');
        const cubiculos = casillas.filter((c) => c.checked).map((c) => Number(c.value));
        if (!cubiculos.length) throw new ErrorApi(400, 'Asigna al menos un cubículo al doctor.');
        const datos = {
          nombre: nombre.value.trim(), cedula: cedula.value.trim(), especialidad: especialidad.value.trim(),
          telefono: telefono.value.trim(), email: email.value.trim(), color: color.value,
          cubiculos, consultorios: [],
        };
        if (doctor) await api.actualizarDoctor(doctor.id, datos);
        else await api.crearDoctor(datos);
        exito(doctor ? 'Doctor actualizado.' : 'Doctor creado y asignado.');
        await refrescar();
      },
      textoBoton: doctor ? 'Guardar cambios' : 'Crear doctor',
    });
  }

  /* -------------------------------- Usuarios ----------------------------- */
  function nuevoUsuario() {
    const nombre = entrada('nombre', { required: true });
    const email = entrada('email', { type: 'email', required: true });
    const password = entrada('password', { type: 'password', required: true, placeholder: 'Mínimo 6 caracteres' });
    const rol = selector('rol', [
      { valor: 'recepcion', texto: 'Recepción' }, { valor: 'doctor', texto: 'Doctor' }, { valor: 'admin', texto: 'Administrador' },
    ], 'recepcion');
    const selDoctor = selector('doctor_id', [
      { valor: '', texto: '— No es doctor —' },
      ...doctores.map((d) => ({ valor: d.id, texto: d.nombre })),
    ], '');

    formModal({
      titulo: 'Dar acceso a alguien del equipo',
      campos: [
        { nodo: campo('Nombre *', nombre) },
        { nodo: el('div', { clase: 'fila' }, [campo('Correo *', email), campo('Contraseña *', password)]) },
        { nodo: el('div', { clase: 'fila' }, [campo('¿Qué hace en el consultorio?', rol), campo('¿Qué doctor es?', selDoctor)]) },
      ],
      alGuardar: async () => {
        await api.crearUsuario({
          nombre: nombre.value.trim(), email: email.value.trim(), password: password.value,
          rol: rol.value, doctor_id: selDoctor.value ? Number(selDoctor.value) : null,
        });
        exito('Usuario creado.');
        await refrescar();
      },
      textoBoton: 'Crear usuario',
    });
  }

  /* -------------------------------- Catálogo ----------------------------- */
  function nuevoCatalogo() {
    const nombre = entrada('nombre', { required: true });
    const descripcion = area('descripcion', {});
    const precio = entrada('precio_base', { type: 'number', step: '0.01', min: '0', value: '0' });
    const duracion = entrada('duracion_min', { type: 'number', min: '5', step: '5', value: '30' });
    const chk = el('input', { type: 'checkbox' });
    const riesgos = area('riesgos', { placeholder: 'Riesgos que se incluirán en el consentimiento' });
    const alternativas = area('alternativas', { placeholder: 'Alternativas terapéuticas' });

    formModal({
      titulo: 'Nuevo tratamiento del catálogo',
      campos: [
        { nodo: campo('Nombre *', nombre) },
        { nodo: campo('Descripción', descripcion) },
        { nodo: el('div', { clase: 'fila' }, [campo('Precio base', precio), campo('Duración (min)', duracion)]) },
        { nodo: el('label', { clase: 'campo', style: 'display:flex;gap:9px;align-items:center' }, [
            chk, el('span', { texto: 'Requiere consentimiento informado' })]) },
        { nodo: campo('Riesgos', riesgos) },
        { nodo: campo('Alternativas', alternativas) },
      ],
      alGuardar: async () => {
        if (!nombre.value.trim()) throw new ErrorApi(400, 'El nombre es obligatorio.');
        await api.crearCatalogo({
          nombre: nombre.value.trim(), descripcion: descripcion.value.trim(),
          precio_base: Number(precio.value || 0), duracion_min: Number(duracion.value || 30),
          requiere_consentimiento: chk.checked, riesgos: riesgos.value.trim(), alternativas: alternativas.value.trim(),
        });
        exito('Tratamiento agregado al catálogo.');
        await refrescar();
      },
      textoBoton: 'Crear tratamiento',
    });
  }

  /* --------------------------------- Vista ------------------------------- */
  return el('div', {}, [
    el('div', { clase: 'cabecera' }, [
      el('div', {}, [
        el('h2', { texto: 'Configuración' }),
        el('div', { clase: 'desc', texto: 'Consultorios, cubículos, doctores, usuarios y catálogo de tratamientos.' }),
      ]),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h3', {}, [
        el('span', { texto: '🏥 Consultorios y cubículos' }),
        el('span', { style: 'margin-left:auto;display:flex;gap:8px' }, [
          el('button', { clase: 'btn sec chico', type: 'button', texto: '➕ Cubículo', onclick: () => nuevoCubiculo(null) }),
          el('button', { clase: 'btn chico', type: 'button', texto: '➕ Consultorio', onclick: nuevoConsultorio }),
        ]),
      ]),
      consultorios.length
        ? el('div', { clase: 'rejilla c2' }, consultorios.map((c) => el('div', {
            style: 'border:1px solid var(--borde);border-radius:10px;padding:14px',
          }, [
            el('b', { texto: c.nombre }),
            el('div', { clase: 'mini', texto: [c.direccion, c.ciudad, c.telefono].filter(Boolean).join(' · ') || 'Sin datos de contacto' }),
            el('div', { style: 'margin-top:10px' }, [
              el('div', { clase: 'mini', texto: `Cubículos (${c.cubiculos.length}):` }),
              c.cubiculos.length
                ? el('ul', { style: 'margin:4px 0 0 18px' }, c.cubiculos.map((cu) =>
                    el('li', { texto: `${cu.nombre}${cu.descripcion ? ` — ${cu.descripcion}` : ''}` })))
                : el('div', { clase: 'mini', texto: 'Sin cubículos. Crea al menos uno para poder agendar.' }),
            ]),
            el('div', { style: 'margin-top:10px' }, [
              el('div', { clase: 'mini', texto: `Doctores asignados (${c.doctores.length}):` }),
              el('div', { clase: 'acciones', style: 'margin-top:4px' },
                c.doctores.map((d) => el('span', { clase: 'eti info', texto: d.nombre }))),
            ]),
            el('div', { clase: 'acciones', style: 'margin-top:12px' }, [
              el('button', { clase: 'btn sec chico', type: 'button', texto: '➕ Añadir cubículo', onclick: () => nuevoCubiculo(c.id) }),
            ]),
          ])))
        : vacio('No hay consultorios. Crea el primero para empezar.'),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h3', {}, [
        el('span', { texto: '🧑‍⚕️ Doctores' }),
        el('button', { clase: 'btn chico', type: 'button', texto: '➕ Nuevo doctor', style: 'margin-left:auto', onclick: () => formDoctor(null) }),
      ]),
      doctores.length
        ? el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
            el('thead', {}, [el('tr', {}, ['Doctor', 'Especialidad', 'Contacto', 'Consultorios', 'Cubículos', ''].map((t) => el('th', { texto: t })))]),
            el('tbody', {}, doctores.map((d) => el('tr', {}, [
              el('td', {}, [
                el('span', { style: `display:inline-block;width:10px;height:10px;border-radius:50%;background:${d.color};margin-right:7px` }),
                el('b', { texto: d.nombre }),
                d.cedula ? el('div', { clase: 'mini', texto: `CI ${d.cedula}` }) : null,
              ]),
              el('td', { texto: d.especialidad || '—' }),
              el('td', { texto: [d.telefono, d.email].filter(Boolean).join(' · ') || '—' }),
              el('td', { texto: d.consultorios.map((c) => c.nombre).join(', ') || '—' }),
              el('td', { texto: d.cubiculos.map((c) => c.nombre).join(', ') || '—' }),
              el('td', {}, [el('button', { clase: 'btn sec chico', type: 'button', texto: 'Editar', onclick: () => formDoctor(d) })]),
            ]))),
          ])])
        : vacio('No hay doctores registrados.'),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h3', {}, [
        el('span', { texto: '👥 Quién puede entrar' }),
        el('button', { clase: 'btn chico', type: 'button', texto: '➕ Nuevo usuario', style: 'margin-left:auto', onclick: nuevoUsuario }),
      ]),
      el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
        el('thead', {}, [el('tr', {}, ['Nombre', 'Correo', 'Qué hace', 'Qué doctor es', 'Puede entrar'].map((t) => el('th', { texto: t })))]),
        el('tbody', {}, usuarios.map((u) => el('tr', {}, [
          el('td', { texto: u.nombre }),
          el('td', { texto: u.email }),
          el('td', {}, [el('span', { clase: 'eti info', texto: NOMBRE_ROL[u.rol] || u.rol })]),
          el('td', { texto: doctores.find((d) => d.id === u.doctor_id)?.nombre || '—' }),
          el('td', { texto: u.activo ? 'Sí' : 'No' }),
        ]))),
      ])]),
    ]),

    el('div', { clase: 'tarjeta' }, [
      el('h3', {}, [
        el('span', { texto: '📚 Tratamientos y precios' }),
        el('button', { clase: 'btn chico', type: 'button', texto: '➕ Nuevo tratamiento', style: 'margin-left:auto', onclick: nuevoCatalogo }),
      ]),
      el('div', { clase: 'tabla-envoltura' }, [el('table', { clase: 'tabla' }, [
        el('thead', {}, [el('tr', {}, ['Tratamiento', 'Precio base', 'Duración', 'Consentimiento'].map((t) => el('th', { texto: t })))]),
        el('tbody', {}, catalogo.map((c) => el('tr', {}, [
          el('td', {}, [el('b', { texto: c.nombre }), c.descripcion ? el('div', { clase: 'mini', texto: c.descripcion }) : null]),
          el('td', { clase: 'num', texto: fmtDinero(c.precio_base) }),
          el('td', { texto: `${c.duracion_min} min` }),
          el('td', {}, [c.requiere_consentimiento
            ? el('span', { clase: 'eti pendiente', texto: 'Requerido' })
            : el('span', { clase: 'mini', texto: 'No' })]),
        ]))),
      ])]),
    ]),
  ]);
}
