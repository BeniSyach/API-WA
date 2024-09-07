const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const { body, validationResult } = require('express-validator');
const socketIO = require('socket.io');
const qrcode = require('qrcode');
const http = require('http');
const fs = require('fs');
const { phoneNumberFormatter } = require('./helpers/formatter');
const axios = require('axios');
const port = process.env.PORT || 8000;
const Host = '0.0.0.0';

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

function delay(t, v) {
  return new Promise(function(resolve) { 
      setTimeout(resolve.bind(null, v), t)
  });
}

app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

app.get('/', (req, res) => {
  res.sendFile('index-multiple-account.html', {
    root: __dirname
  });
});

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';

const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}

createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE));
  }
  catch (err) {
    return console.log(err.Error);
  }
}

const createSession = function(id, description) {
  console.log('Creating session: ' + id);
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-extensions',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--enable-gpu'
      ],
    },
    authStrategy: new LocalAuth({
      clientId: id
    })
  });

  client.initialize();

  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit('qr', { id: id, src: url });
      io.emit('message', { id: id, text: 'QR Code received, scan please!' });

      const savedSessions = getSessionsFile();
      const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
      savedSessions[sessionIndex].qrCodeUrl = url;
      savedSessions[sessionIndex].qrCodeTime = new Date(Date.now()).toString();
      setSessionsFile(savedSessions);
    });
  });

  client.on('ready', () => {
    io.emit('ready', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is ready!' });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', () => {
    io.emit('authenticated', { id: id });
    io.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
  });

  client.on('auth_failure', function() {
    io.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    io.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    client.initialize();
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}

const init = function(socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id, sess.description);
      });
    }
  }
}

init();

// Socket IO
io.on('connection', function(socket) {
  init(socket);

  socket.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id, data.description);
  });
});

async function getStatusById(id) {
  const client = sessions.find(sess => sess.id == id)?.client;
  
  try {
    const contacts = await client.getContacts();
    // Se a promessa acima for resolvida, significa que a autenticação foi bem-sucedida
    return { authenticated: true, clientInfo: client.info };
  } catch (error) {
    // Se a promessa acima for rejeitada, significa que houve um erro na autenticação
    return { authenticated: false };
  }
}

app.post('/send-message', [
  body('number').notEmpty(),
  body('message').notEmpty(),
  body('sender').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = req.body.number;
  const numberDDI = number.substr(0, 2);
  const numberDDD = number.substr(2, 2);
  const numberUser = number.substr(-8, 8);
  const message = req.body.message;
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;

  if (numberDDI !== "55") {
    const numberZDG = number + "@c.us";
    client.sendMessage(numberZDG, message).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
  else if (numberDDI === "55" && parseInt(numberDDD) <= 30) {
    const numberZDG = "55" + numberDDD + "9" + numberUser + "@c.us";
    client.sendMessage(numberZDG, message).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
  else if (numberDDI === "55" && parseInt(numberDDD) > 30) {
    const numberZDG = "55" + numberDDD + numberUser + "@c.us";
    client.sendMessage(numberZDG, message).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
});

app.post('/send-media', [
  body('number').notEmpty(),
  body('file').notEmpty(),
  body('sender').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = req.body.number;
  const numberDDI = number.substr(0, 2);
  const numberDDD = number.substr(2, 2);
  const numberUser = number.substr(-8, 8);
  const file = req.body.file;
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  const media = MessageMedia.fromFilePath(file);
  let audio;

  if(media.mimetype.startsWith('audio'))
      audio == true;

  if (numberDDI !== "55") {
    const numberZDG = number + "@c.us";
    client.sendMessage(numberZDG, media, {sendAudioAsVoice: audio}).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
  else if (numberDDI === "55" && parseInt(numberDDD) <= 30) {
    const numberZDG = "55" + numberDDD + "9" + numberUser + "@c.us";
    client.sendMessage(numberZDG, media, {sendAudioAsVoice: audio}).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
  else if (numberDDI === "55" && parseInt(numberDDD) > 30) {
    const numberZDG = "55" + numberDDD + numberUser + "@c.us";
    client.sendMessage(numberZDG, media, {sendAudioAsVoice: audio}).then(response => {
    res.status(200).json({
      status: true,
      message: 'BOT-LUCAS Mensagem enviada',
      response: response
    });
    }).catch(err => {
    res.status(500).json({
      status: false,
      message: 'BOT-LUCAS Mensagem não enviada',
      response: err.text
    });
    });
  }
});

app.post('/send-message-media', [
  body('number').notEmpty(),
  body('caption').notEmpty(),
  body('file').notEmpty(),
  body('sender').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped()
    });
  }

  const number = req.body.number;
  const numberDDI = number.substr(0, 2);
  const numberDDD = number.substr(2, 2);
  const numberUser = number.substr(-8, 8);
  const caption = req.body.caption;
  const file = req.body.file;
  const sender = req.body.sender;
  const client = sessions.find(sess => sess.id == sender)?.client;
  const media = MessageMedia.fromFilePath(file);
  let audio;

  if(media.mimetype.startsWith('image')) {
    if (numberDDI !== "55") {
      const numberZDG = number + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
    else if (numberDDI === "55" && parseInt(numberDDD) <= 30) {
      const numberZDG = "55" + numberDDD + "9" + numberUser + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
    else if (numberDDI === "55" && parseInt(numberDDD) > 30) {
      const numberZDG = "55" + numberDDD + numberUser + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
  }
  else if(media.mimetype.startsWith('application/pdf')) {
    if (numberDDI !== "55") {
      const numberZDG = number + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
    else if (numberDDI === "55" && parseInt(numberDDD) <= 30) {
      const numberZDG = "55" + numberDDD + "9" + numberUser + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
    else if (numberDDI === "55" && parseInt(numberDDD) > 30) {
      const numberZDG = "55" + numberDDD + numberUser + "@c.us";
      client.sendMessage(numberZDG, media, {caption: caption}).then(response => {
      res.status(200).json({
        status: true,
        message: 'BOT-LUCAS Mensagem enviada',
        response: response
      });
      }).catch(err => {
      res.status(500).json({
        status: false,
        message: 'BOT-LUCAS Mensagem não enviada',
        response: err.text
      });
      });
    }
  }
  else {
    return res.status(401).json({error: "Esse metodo foi configurado para receber apenas arquivos dos tipos: imagem & pdf"})
  } 
});

app.delete('/delete-session/:id', async (req, res) => {
  const id = req.params.id;

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex === -1) {
    return res.status(404).json({ status: false, message: `Session with ID ${id} not found.` });
  }

  try {
    const client = sessions.find(sess => sess.id == id)?.client;

    if (!client) {
      return res.status(500).json({ status: false, message: `Client for session with ID ${id} not found.` });
    }

    await client.destroy();

    // Remove the session from the list of sessions
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    return res.status(200).json({ status: true, message: `Session with ID ${id} deleted successfully.` });
  } catch (error) {
    return res.status(500).json({ status: false, message: `Error deleting session: ${error.message}` });
  }
});

app.get('/get-sessions', async (req, res) => {
  const sessions = getSessionsFile();
  return res.json(sessions);
});

app.get('/get-session/:id', async (req, res) => {
  const id = req.params.id;
  const sessions = getSessionsFile();
  const client = sessions.findIndex(sess => sess.id == id);

  return res.json(sessions[client]);
});

app.post('/create-session', async (req, res) => {
  const id = req.body.id;
  const description = req.body.description;

  try{
    await createSession(id, description);
    return res.status(201).json({status: true});
  }
  catch (err) {
    return res.status(500).json({status: false, error: err});
  }
})

app.delete('/fila/:id', async (req, res) => {
  const id = req.params.id;
  const client = sessions.find(sess => sess.id == id)?.client;

  try{
    await client.destroy();
    return res.status(200);
  }
  catch (err) {
    return res.status(500).json({error: err});
  }

})

app.get('/update-session/:id/:name', async (req, res) => {
  const id = req.params.id;
  const name = req.params.name;

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);

  if (sessionIndex === -1) {
    return res.status(404).json({ status: false, message: `Session with ID ${id} not found.` });
  }

  try {
    const client = sessions.find(sess => sess.id == id)?.client;

    if (!client) {
      return res.status(500).json({ status: false, message: `Client for session with ID ${id} not found.` });
    }

    savedSessions[sessionIndex].description = name;
    setSessionsFile(savedSessions);

    return res.status(200).json({ status: true, message: `Session with ID ${id} updated successfully.` });
  } catch (error) {
    return res.status(500).json({ status: false, message: `Error updating session: ${error.message}` });
  }
});

app.get('/qr-code/:id', async (req, res) => {
  const id = req.params.id;
  const client = sessions.find(sess => sess.id == id)?.client;
  const authenticated = false;

  try {
    const status = await getStatusById(id); // Obter o status usando a função criada

    if (status.authenticated) {
      // Se a autenticação foi bem-sucedida, retorne a resposta JSON
      return res.status(200).json({ authenticated: true });
    }
    else {
      let qr = await new Promise((resolve, reject) => {
        client.once('qr', (qr) => resolve(qr));
        setTimeout(() => {
          reject(new Error("O QR-Code vai ser gerado em até 15 segundos, aguarde e tente novamente"));
        }, 22000);
      });
  
      qrcode.toDataURL(qr, (err, url) => {
        res.json({ qrCodeUrl: url });
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
})

app.get('/status/:id', async (req, res) => {
  const id = req.params.id;
  const client = sessions.find(sess => sess.id == id)?.client;

  client.getContacts()
      .then((contacts) => {
        return res.status(200).json({authenticated: true, clientInfo: client.info});
      })
      .catch((error) => {
        return res.status(200).json({authenticated: false});
      });
})

server.listen(port, Host, function() {
  console.log('App running on *: ' + port);
});
