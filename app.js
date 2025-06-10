require('dotenv').config();
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

// Cambia el valor de MONGO_URI en tu archivo .env por tu cadena de conexión de MongoDB Atlas
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = 'gym';
const PORT = 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

let db;

// --- Rutinas predefinidas completadas (global, sin usuarios) ---

// Obtener todas las rutinas predefinidas marcadas como completadas
app.get('/rutinas_predefinidas_completadas', async (req, res) => {
    try {
        const doc = await db.collection('estado_rutinas').findOne({ tipo: 'predefinidas_completadas' });
        res.json(doc && Array.isArray(doc.valor) ? doc.valor : []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Guardar el array de rutinas predefinidas completadas
app.post('/rutinas_predefinidas_completadas', async (req, res) => {
    try {
        const completadas = req.body.completadas; // Array de objetos {semana, dia}
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

// Obtener la rutina de hoy
app.get('/rutina_hoy', async (req, res) => {
    try {
        const hoy = new Date();
        const utc3 = new Date(hoy.getTime() - 3 * 60 * 60 * 1000); // Ajuste a UTC-3
        const fechaHoy = utc3.toISOString().slice(0, 10);

        // Busca rutinas de hoy
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

        // Ajusta el formato para el frontend
        const resultado = rutinas.map(r => ({
            rutina_id: r.rutina_id,
            ...r.ejercicio,
            historial_series: r.historial_series || null
        }));

        res.json(resultado);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener historial de un ejercicio
app.get('/historial/:ejercicio_id', async (req, res) => {
    try {
        const ejercicioId = req.params.ejercicio_id;
        const historial = await db.collection('historial_series')
            .find({ ejercicio_id: new ObjectId(ejercicioId) })
            .sort({ fecha: 1 })
            .toArray();
        res.json(historial);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Ruta para validar contraseña de acceso a agregar-ejercicio.html
app.post('/validar-clave', (req, res) => {
    const { clave } = req.body;
    // Cambia '6573' por la clave que quieras
    if (clave === '6573') {
        res.json({ acceso: true });
    } else {
        res.json({ acceso: false });
    }
});

// Agregar ejercicio a la rutina de hoy
app.post('/rutina_hoy', async (req, res) => {
    try {
        const { ejercicio_id } = req.body;
        const hoy = new Date();
        const utc3 = new Date(hoy.getTime() - 3 * 60 * 60 * 1000); // Ajuste a UTC-3
        const fechaHoy = utc3.toISOString().slice(0, 10);

        const result = await db.collection('rutina_hoy').insertOne({
            ejercicio_id: new ObjectId(ejercicio_id),
            fecha: fechaHoy
        });
        res.json({ success: true, id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar ejercicio de la rutina de hoy
app.delete('/rutina_hoy/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection('rutina_hoy').deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar un ejercicio
app.delete('/ejercicios/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection('ejercicios').deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Borrar historial de un ejercicio
app.delete('/historial/:ejercicio_id', async (req, res) => {
    try {
        const ejercicioId = req.params.ejercicio_id;
        await db.collection('historial_series').deleteMany({ ejercicio_id: new ObjectId(ejercicioId) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Eliminar una entrada individual del historial por su _id
app.delete('/historial/entrada/:id', async (req, res) => {
    try {
        const id = req.params.id;
        await db.collection('historial_series').deleteOne({ _id: new ObjectId(id) });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Resetear las series de un ejercicio a su valor original
app.put('/ejercicios/:id/reset_series', async (req, res) => {
    try {
        const id = req.params.id;
        const ejercicio = await db.collection('ejercicios').findOne({ _id: new ObjectId(id) });
        if (!ejercicio) return res.status(404).json({ error: 'Ejercicio no encontrado' });
        await db.collection('ejercicios').updateOne(
            { _id: new ObjectId(id) },
            { $set: { series: ejercicio.series_original } }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Guardar series e historial
app.put('/ejercicios/serie', async (req, res) => {
    try {
        const { rutina_id, series, fecha } = req.body;
        if (!series) return res.status(400).json({ error: 'Faltan datos de series' });

        // Busca la rutina y el ejercicio
        const rutina = await db.collection('rutina_hoy').findOne({ _id: new ObjectId(rutina_id) });
        if (!rutina) return res.status(404).json({ error: 'Rutina no encontrada' });

        await db.collection('ejercicios').updateOne(
            { _id: rutina.ejercicio_id },
            { $set: { series } }
        );

        // Guarda historial
        const fechaFinal = fecha || new Date().toISOString().slice(0, 10);
        await db.collection('historial_series').insertOne({
            ejercicio_id: rutina.ejercicio_id,
            series_string: series,
            fecha: fechaFinal
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Crear un nuevo ejercicio
app.post('/ejercicios', async (req, res) => {
    try {
        const { codigo, grupo_muscular, nombre, series, tipo, descripcion, url } = req.body;
        if (!codigo || !grupo_muscular || !nombre || !series || !tipo) {
            return res.status(400).json({ error: 'Faltan campos obligatorios' });
        }
        const result = await db.collection('ejercicios').insertOne({
            codigo,
            grupo_muscular,
            nombre,
            series,
            tipo,
            descripcion: descripcion || "",
            url: url || "",
            series_original: series
        });
        res.json({ success: true, id: result.insertedId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener todas las rutinas predefinidas
app.get('/rutinas_predefinidas', async (req, res) => {
    try {
        const rutinas = await db.collection('rutinas_predefinidas').find().toArray();
        res.json(rutinas);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Obtener ejercicios de una rutina predefinida por semana y número
app.get('/rutinas_predefinidas/:semana/:numero', async (req, res) => {
    try {
        const semana = parseInt(req.params.semana);
        const numero = parseInt(req.params.numero);
        const rutina = await db.collection('rutinas_predefinidas').findOne({ semana, numero });
        if (!rutina) return res.status(404).json({ error: 'Rutina no encontrada' });

        // Trae los ejercicios completos
        const ejercicios = await db.collection('ejercicios').find({
            _id: { $in: rutina.ejercicios.map(id => new ObjectId(id)) }
        }).toArray();

        res.json({ ...rutina, ejercicios });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Manejo de rutas no encontradas
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

/*
COMENTARIOS IMPORTANTES:
- Cambia el valor de MONGO_URI en tu archivo .env por tu cadena de conexión de MongoDB Atlas.
- Si cambias el nombre de la base de datos, actualiza DB_NAME.
- Si cambias el puerto, actualiza PORT.
- Asegúrate de que el frontend use los IDs correctos (_id de MongoDB y rutina_id).
- Si tu frontend está en otro dominio, puedes restringir CORS para mayor seguridad.
*/