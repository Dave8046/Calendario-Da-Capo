import admin from 'firebase-admin';

// Inicializar Firebase Admin SDK si no está inicializado
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
      })
    });
  } catch (err) {
    console.error('Error al inicializar Firebase Admin:', err);
  }
}

const db = admin.firestore();

export default async function handler(req, res) {
  // 1. VERIFICACIÓN DEL WEBHOOK (GET - Solicitud de Meta)
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Este token debe coincidir con el que pongas en Meta Developers
    const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'dacapo_secure_token';

    if (mode && token) {
      if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        return res.status(200).send(challenge);
      } else {
        return res.status(403).json({ error: 'Token de verificación incorrecto' });
      }
    }
    return res.status(400).json({ error: 'Parámetros faltantes' });
  }

  // 2. RECEPCIÓN DE MENSAJES (POST - Mensajes entrantes de WhatsApp)
  if (req.method === 'POST') {
    try {
      const body = req.body;

      if (body.object === 'whatsapp_business_account') {
        const entry = body.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];

        if (message) {
          const senderPhone = message.from; // Número del remitente (ej: 57310...)
          const messageText = message.text?.body?.trim().toLowerCase() || '';
          const phoneNumberId = value.metadata.phone_number_id;

          // Buscar alumno en Firestore comparando el número de teléfono
          const studentsSnapshot = await db.collection('students').get();
          let matchedStudent = null;

          studentsSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.phone) {
              const cleanDbPhone = data.phone.replace(/[^0-9]/g, '');
              const cleanSenderPhone = senderPhone.replace(/[^0-9]/g, '');
              if (cleanSenderPhone.includes(cleanDbPhone) || cleanDbPhone.includes(cleanSenderPhone)) {
                matchedStudent = { id: doc.id, ...data };
              }
            }
          });

          let responseText = '';

          if (!matchedStudent) {
            responseText = `🎶 ¡Hola! Te comunicaste con *Casa Musical Da Capo*.\nNo encontramos este número registrado en nuestro sistema principal.\n\n1️⃣ Solicitar información e inscripciones\n2️⃣ Hablar con la administración`;
          } else {
            const name = matchedStudent.name || 'Estudiante';

            if (messageText.includes('1') || messageText.includes('clase') || messageText.includes('horario')) {
              responseText = `📅 *Tus horarios de clase, ${name}:*\n🎵 Instrumento: ${matchedStudent.instrument || 'Música'}\n👨‍🏫 Profesor: ${matchedStudent.teacher || 'Da Capo'}\n⏰ Horario: ${matchedStudent.day1 || ''} (${matchedStudent.time1 || ''})${matchedStudent.day2 ? ` y ${matchedStudent.day2} (${matchedStudent.time2})` : ''}`;
            } else if (messageText.includes('2') || messageText.includes('pago') || messageText.includes('cuenta')) {
              if (matchedStudent.paid) {
                responseText = `✅ *Estado de Cuenta: AL DÍA*\n¡Hola ${name}! No tienes mensualidades pendientes. Tu próximo vencimiento es el ${matchedStudent.dueDate || 'pronto'}. ¡Gracias por tu puntualidad! 🎶`;
              } else {
                responseText = `⚠️ *Estado de Cuenta: PENDIENTE*\nHola ${name}, tienes una mensualidad pendiente por valor de $${(matchedStudent.fee||0).toLocaleString()} (Vence el ${matchedStudent.dueDate||'pronto'}).\n\nPuedes transferir y enviar tu comprobante por este medio. ✨`;
              }
            } else if (messageText.includes('3') || messageText.includes('asistencia')) {
              responseText = `📊 *Reporte de Asistencia*\nHola ${name}, puedes revisar tus estadísticas detalladas de asistencia mes a mes ingresando directamente a la app web de Da Capo en tu sección de perfil. ✨`;
            } else if (messageText.includes('5') || messageText.includes('repertorio') || messageText.includes('avance')) {
              responseText = `🎼 *Progreso de Repertorio*\n${name}, tus notas actuales registradas son:\n"${matchedStudent.repertoireNotes || 'Sin notas de repertorio registradas este mes.'}"`;
            } else {
              // Menú principal por defecto
              responseText = `🎶 *¡Hola ${name}! Bienvenido/a a Casa Musical Da Capo.*\n\nElige una opción respondiendo con el número:\n1️⃣ Mis Clases y Horarios\n2️⃣ Estado de Cuenta y Pagos\n3️⃣ Reporte de Asistencia\n4️⃣ Notificar Inasistencia\n5️⃣ Avance de Repertorio\n6️⃣ Hablar con la Administración`;
            }
          }

          // Enviar respuesta a través de la Cloud API de Meta
          await sendWhatsAppMessage(phoneNumberId, senderPhone, responseText);
        }
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error('Error procesando webhook:', error);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}

async function sendWhatsAppMessage(phoneNumberId, recipientPhone, message) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: recipientPhone,
      type: 'text',
      text: { body: message }
    }),
  });

  if (!response.ok) {
    const errData = await response.text();
    console.error('Error enviando mensaje a WhatsApp:', errData);
  }
}