require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'gym';
const PORT = 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

let db;

// Conexión a MongoDB
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
    .then(client => {
        db = client.db(DB_NAME);
        console.log('✅ Conectado a MongoDB Atlas');
        app.listen(PORT, () => {
            console.log(`🟢 Servidor listo en http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error('❌ Error al conectar a MongoDB:', err);
        process.exit(1);
    });

// Obtener todos los ejercicios
app.get('/ejercicios', async (req, res) => {
    try {
        const ejercicios = await db.collection('ejercicios').find().toArray();
        res.json(ejercicios);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener la rutina de hoy (INCLUYE COMENTARIO)
app.get('/rutina_hoy', async (req, res) => {
    try {
        const hoy = new Date();
        const utc3 = new Date(hoy.getTime() - 3 * 60 * 60 * 1000);
        const fechaHoy = utc3.toISOString().slice(0, 10);

        const rutinas = await db.collection('rutina_hoy').aggregate([
            { $match: { fecha: fechaHoy } },
            {
                $lookup: {
                    from: 'ejercicios',
                    localField: 'ejercicio_id',
                    foreignField: '_id',
                    as: 'ejercicio'
                }
            },
            { $unwind: '$ejercicio' },
            {
                $addFields: {
                    rutina_id: '$_id',
                    historial_series: {
                        $reduce: {
                            input: {
                                $map: {
                                    input: {
                                        $filter: {
                                            input: "$ejercicio.historial_series",
                                            as: "h",
                                            cond: { $eq: ["$$h.fecha", fechaHoy] }
                                        }
                                    },
                                    as: "h",
                                    in: { $split: ["$$h.series_string", "\n"] }
                                }
                            },
                            initialValue: [],
                            in: { $concatArrays: ["$$value", "$$this"] }
                        }
                    }
                }
            }
        ]).toArray();

        // Incluye el comentario de la rutina_hoy
        const resultado = rutinas.map(r => ({
            rutina_id: r.rutina_id,
            ...r.ejercicio,
            historial_series: r.historial_series || null,
            comentario: r.comentario || '', // <-- aquí
        }));

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Guardar o actualizar el comentario de un ejercicio en la rutina de hoy
app.put('/rutina_hoy/:id/comentario', async (req, res) => {
    const { comentario } = req.body;
    const { id } = req.params;
    try {
        await db.collection('rutina_hoy').updateOne(
            { _id: new ObjectId(id) },
            { $set: { comentario } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Agregar ejercicio a la rutina de hoy
app.post('/rutina_hoy', async (req, res) => {
    try {
        const { ejercicio_id } = req.body;
        const hoy = new Date();
        const utc3 = new Date(hoy.getTime() - 3 * 60 * 60 * 1000);
        const fechaHoy = utc3.toISOString().slice(0, 10);

        await db.collection('rutina_hoy').insertOne({
            ejercicio_id: new ObjectId(ejercicio_id),
            fecha: fechaHoy,
            comentario: ""
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar ejercicio de la rutina de hoy
app.delete('/rutina_hoy/:id', async (req, res) => {
    try {
        await db.collection('rutina_hoy').deleteOne({ _id: new ObjectId(req.params.id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Actualizar series de un ejercicio en rutina_hoy
app.put('/ejercicios/serie', async (req, res) => {
    try {
        const { rutina_id, series, fecha } = req.body;
        await db.collection('rutina_hoy').updateOne(
            { _id: new ObjectId(rutina_id) },
            { $set: { series, fecha } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Rutinas predefinidas completadas (global, sin usuarios)
app.get('/rutinas_predefinidas_completadas', async (req, res) => {
    try {
        const doc = await db.collection('estado_rutinas').findOne({ tipo: 'predefinidas_completadas' });
        res.json(doc && Array.isArray(doc.valor) ? doc.valor : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/rutinas_predefinidas_completadas', async (req, res) => {
    try {
        const completadas = req.body.completadas;
        await db.collection('estado_rutinas').updateOne(
            { tipo: 'predefinidas_completadas' },
            { $set: { valor: completadas } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/validar-clave', (req, res) => {
    const { clave } = req.body;
    // Cambia '6573' por la clave que quieras usar
    if (clave === '6573') {
        res.json({ acceso: true });
    } else {
        res.status(401).json({ acceso: false });
    }
});

app.get('/historial/:id', async (req, res) => {
    try {
        const ejercicioId = req.params.id;
        // Ajusta la colección y la consulta según tu estructura de datos
        const historial = await db.collection('historial')
            .find({ ejercicio_id: new ObjectId(ejercicioId) })
            .sort({ fecha: -1 })
            .toArray();
        res.json(historial);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});