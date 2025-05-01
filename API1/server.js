require('dotenv').config();
const mqtt = require('mqtt');
const mysql = require('mysql2');
const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());
const port = process.env.PORT;
const TIMEOUT_MS = 10000;

let TimeOuts = {
    temperatura: null,
    humedad: null,
    co2: null,
    personas: null,
    voltage: null,
    luminosidad: null
};

let AlertasNotificacion = {
    PuertaAbierta: null,
    PuertaCerrada: null,
    LucesEncendidas: null,
    LucesApagadas: null,
};

let AlertasVisuales = {
    TemperaturaAlta: null,
    HumedadAlta: null,
    NivelVoltaje: null,
    CantidadLuz: null,
    PersonaPasando: null,
    CO2Alto: null
};



function ReiniciarTimeout(tabla) {
    if (TimeOuts[tabla]) clearTimeout(TimeOuts[tabla]);
    TimeOuts[tabla] = setTimeout(() => {
        DatosTiempoReal[tabla] = { valor: '-', fecha: '-', hora: '-' };
    }, TIMEOUT_MS);
}

// Conexión MQTT
const MQTT_Cliente = mqtt.connect('mqtts://j2b65675.ala.us-east-1.emqxsl.com:8883', {
    username: 'ARQUI2',
    password: '1234'
});

// Conexión A La Base De Datos
const ConfiguracionBD = mysql.createConnection({
    host: 'database-1.ct6qau0im2yu.us-east-2.rds.amazonaws.com',
    user: 'admin',
    password: 'arqui2basededatos__',
    database: 'mibasededatos'
});

let DatosTiempoReal = {
    temperatura: { valor: '-', fecha: '-', hora: '-' },
    humedad: { valor: '-', fecha: '-', hora: '-' },
    co2: { valor: '-', fecha: '-', hora: '-' },
    personas: { valor: '-', fecha: '-', hora: '-' },
    voltage: { valor: '-', fecha: '-', hora: '-' },
    luminosidad: { valor: '-', fecha: '-', hora: '-' }
};

ConfiguracionBD.connect((err) => {
    if (err) {
        console.error('Error Al Conectar A La Base De Datos:', err);
        process.exit(1);
    } else {
        console.log('Conexión A La Base De Datos Establecida.');
        console.log("--------------------------------------------")
    }
});

MQTT_Cliente.on('connect', () => {
    MQTT_Cliente.subscribe('sensores/#', (err) => {
        if (err) {
            console.error('Error Al Suscribirse A MQTT Topic:', err);
        } else {
            console.log('Conexión Al Broker MQTT Establecido - Sensores.');
            console.log("--------------------------------------------")
        }
    });

    MQTT_Cliente.subscribe('alerta/#', (err) => {
        if (err) {
            console.error('Error Al Suscribirse A MQTT Topic:', err);
        } else {
            console.log('Conexión Al Broker MQTT Establecido - Alerta.');
            console.log("--------------------------------------------")
        }
    });
});

MQTT_Cliente.on('message', (topic, message) => {
    console.log(`Mensaje Recibido En Topic: ${topic}: ${message.toString()}`);
    console.log("--------------------------------------------");
    try {
        const payload = JSON.parse(message.toString());
        const tabla = topic.split('/')[1];
        const now = new Date();
        const fecha = now.toLocaleDateString('sv-SE');
        const hora = now.toTimeString().split(' ')[0];
        if (topic.startsWith("alerta/")) {
            const alerta = payload.alerta;
            if (alerta && AlertasNotificacion.hasOwnProperty(alerta)) {
                AlertasNotificacion[alerta] = {
                    tipo: alerta,
                    fecha,
                    hora
                };
                console.log("Alerta Notificacion guardada:", AlertasNotificacion);
            } else if (alerta && AlertasVisuales.hasOwnProperty(alerta)) {
                AlertasVisuales[alerta] = {
                    tipo: alerta,
                    fecha,
                    hora
                };
                console.log("Alerta Visual guardada:", AlertasVisuales);
            } else {
                console.warn(`Payload de alerta inválido:`, payload);
            }
            return;
        } else {
            const valor = payload.valor;
            InsertarDatos(tabla, valor, fecha, hora);
            ReiniciarTimeout(tabla);
            if (tabla && DatosTiempoReal[tabla]) {
                DatosTiempoReal[tabla] = { valor, fecha, hora };
            }
        }
    } catch (err) {
        console.error('Error Al Procesar Mensaje MQTT:', err);
    }
});

function InsertarDatos(tabla, lectura, fecha, hora) {
    if (lectura !== undefined && lectura !== '') {
        const query = `INSERT INTO ${tabla} (lectura, fecha, hora) VALUES (?, ?, ?)`;
        ConfiguracionBD.query(query, [lectura, fecha, hora], (err, result) => {
            if (err) {
                console.error(`Error Al Insertar En: ${tabla}:`, err);
            } else {
                console.log(`Insertado En:${tabla}. Valor: ${lectura}. Fecha: ${fecha}. Hora:${hora}.`);
                console.log("--------------------------------------------")
            }
        });
    } else {
        console.warn(`Lectura Vacía O Indefinida Para Tabla:${tabla}`);
    }
}

app.get('/datos-tiempo-real', (req, res) => {
    const DatosCompletos = Object.values(DatosTiempoReal).every(d => d.valor !== null && d.valor !== '-');
    if (!DatosCompletos) {
        return res.status(200).json({ 
            status: 'error',
            message: 'No Hay Datos Disponibles En Este Momento' 
        });
    }
    const respuesta = {
        status: 'success',
        sensores: DatosTiempoReal
    };
    res.status(200).json(respuesta);
});

app.post('/publicar-mqtt', (req, res) => {
    const { topic, mensaje } = req.body;
    if (!topic || !mensaje) {
        return res.status(400).json({ error: 'Faltan datos: topic o mensaje' });
    }
    MQTT_Cliente.publish(topic, mensaje, (err) => {
        if (err) {
            console.error('Error al publicar en MQTT:', err);
            return res.status(500).json({ error: 'Error al publicar en MQTT' });
        }
        console.log(`Mensaje publicado en [${topic}]: ${mensaje}`);
        return res.status(200).json({ success: true });
    });
});

app.get('/api/alerta-toast', (req, res) => {
    const disponibles = {};
    for (const tipo in AlertasNotificacion) {
        if (AlertasNotificacion[tipo] !== null) {
            disponibles[tipo] = AlertasNotificacion[tipo];
        }
    }
    if (Object.keys(disponibles).length === 0) {
        return res.status(404).json({ error: 'No hay notificaciones disponibles' });
    }

    for (const tipo in AlertasNotificacion) {
        AlertasNotificacion[tipo] = null;
    }
    res.json(disponibles);
});

app.get('/api/alerta-visual', (req, res) => {
    const disponibles = {};
    for (const tipo in AlertasVisuales) {
        if (AlertasVisuales[tipo] !== null) {
            disponibles[tipo] = AlertasVisuales[tipo];
        }
    }
    if (Object.keys(disponibles).length === 0) {
        return res.status(404).json({ error: 'No hay alertas visuales disponibles' });
    }
    
    for (const tipo in AlertasVisuales) {
        AlertasVisuales[tipo] = null;
    }

    res.json(disponibles);
});


app.listen(port, () => {
    console.log(`API escuchando en http://localhost:${port}`);
    console.log("--------------------------------------------")
});

app.use(cors());   