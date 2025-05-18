const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const db = new sqlite3.Database('./db/database.sqlite', (err) => {
    if (err) return console.error('Error al conectar a SQLite:', err.message);
    console.log('✅ Conectado a SQLite.');
    inicializarBD();
});

function inicializarBD() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS ejercicios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT NOT NULL UNIQUE,
            grupo_muscular TEXT NOT NULL,
            nombre TEXT NOT NULL,
            series TEXT NOT NULL,
            tipo TEXT NOT NULL,
            series_original TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS rutina_hoy (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ejercicio_id INTEGER NOT NULL,
            fecha TEXT DEFAULT CURRENT_DATE,
            FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS historial_series (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ejercicio_id INTEGER NOT NULL,
            fecha TEXT DEFAULT CURRENT_DATE,
            series_string TEXT NOT NULL,
            FOREIGN KEY (ejercicio_id) REFERENCES ejercicios(id)
        )`);

        db.get("SELECT COUNT(*) AS count FROM ejercicios", (err, row) => {
            if (row.count === 0) {
                const ejerciciosEjemplo = [
                    {
                        codigo: '001', grupo_muscular: 'Pecho', nombre: 'Press de banca plano',
                        series: 'S1 R8 F8 K40 +2.5\nS2 R8 F8 K40 +0\nS3 R8 F8 K40 +0', tipo: 'series_fijas'
                    },
                    {
                        codigo: '002', grupo_muscular: 'Pecho', nombre: 'Press inclinado con mancuernas',
                        series: 'S1 R10 F10 K20 +1.5\nS2 R10 F8 K20 +0', tipo: 'series_fijas'
                    },
                    {
                        codigo: '003', grupo_muscular: 'Piernas', nombre: 'Sentadillas libres',
                        series: 'SN R50 F15-15-10-10 K30 +5', tipo: 'repeticiones_totales'
                    }
                ];

                const stmt = db.prepare(`
                    INSERT INTO ejercicios (codigo, grupo_muscular, nombre, series, tipo, series_original)
                    VALUES (?, ?, ?, ?, ?, ?)`);

                ejerciciosEjemplo.forEach(ej => {
                    stmt.run([ej.codigo, ej.grupo_muscular, ej.nombre, ej.series, ej.tipo, ej.series]);
                });
                stmt.finalize();
            }
        });
    });
}

// Obtener todos los ejercicios
app.get('/ejercicios', (req, res) => {
    db.all("SELECT * FROM ejercicios", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Obtener la rutina de hoy
app.get('/rutina_hoy', (req, res) => {
    const query = `
        SELECT rutina_hoy.id AS rutina_id, ejercicios.*,
        (SELECT series_string FROM historial_series WHERE ejercicio_id = ejercicios.id ORDER BY fecha DESC LIMIT 1) AS historial_series
        FROM rutina_hoy
        JOIN ejercicios ON rutina_hoy.ejercicio_id = ejercicios.id
        WHERE rutina_hoy.fecha = CURRENT_DATE
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Obtener historial de un ejercicio
app.get('/historial/:ejercicio_id', (req, res) => {
    const ejercicioId = req.params.ejercicio_id;
    const query = `
        SELECT fecha, series_string FROM historial_series
        WHERE ejercicio_id = ?
        ORDER BY fecha ASC
    `;
    db.all(query, [ejercicioId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Agregar ejercicio a la rutina de hoy
app.post('/rutina_hoy', (req, res) => {
    const { ejercicio_id } = req.body;
    const query = `INSERT INTO rutina_hoy (ejercicio_id) VALUES (?)`;
    db.run(query, [ejercicio_id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// Eliminar ejercicio de la rutina de hoy
app.delete('/rutina_hoy/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM rutina_hoy WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});



// Eliminar un ejercicio
app.delete('/ejercicios/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM ejercicios WHERE id = ?', [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Borrar historial de un ejercicio
app.delete('/historial/:ejercicio_id', (req, res) => {
    const ejercicioId = req.params.ejercicio_id;
    db.run('DELETE FROM historial_series WHERE ejercicio_id = ?', [ejercicioId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
    });
});

// Resetear las series de un ejercicio a su valor original
app.put('/ejercicios/:id/reset_series', (req, res) => {
    const id = req.params.id;
    db.run(
        'UPDATE ejercicios SET series = series_original WHERE id = ?',
        [id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        }
    );
});

app.put('/ejercicios/serie', (req, res) => {
    const { rutina_id, series, fecha } = req.body;
    if (!series) return res.status(400).json({ error: 'Faltan datos de series' });

    const select = `
        SELECT ejercicios.id FROM rutina_hoy
        JOIN ejercicios ON rutina_hoy.ejercicio_id = ejercicios.id
        WHERE rutina_hoy.id = ?`;

    db.get(select, [rutina_id], (err, row) => {
        if (err || !row) return res.status(500).json({ error: 'Ejercicio no encontrado' });

        db.run(`UPDATE ejercicios SET series = ? WHERE id = ?`, [series, row.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });

            // Usa la fecha recibida o la actual ajustada a UTC-3
            let fechaFinal = fecha;
            if (!fechaFinal) {
                const now = new Date();
                const utc3 = new Date(now.getTime() - 3 * 60 * 60 * 1000);
                fechaFinal = utc3.toISOString().slice(0, 10);
            }
            db.run(
                `INSERT INTO historial_series (ejercicio_id, series_string, fecha) VALUES (?, ?, ?)`,
                [row.id, series, fechaFinal],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true });
                }
            );
        });
    });
});

// Crear un nuevo ejercicio
app.post('/ejercicios', (req, res) => {
    const { codigo, grupo_muscular, nombre, series, tipo } = req.body;
    if (!codigo || !grupo_muscular || !nombre || !series || !tipo) {
        return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    const query = `
        INSERT INTO ejercicios (codigo, grupo_muscular, nombre, series, tipo, series_original)
        VALUES (?, ?, ?, ?, ?, ?)`;
    db.run(query, [codigo, grupo_muscular, nombre, series, tipo, series], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
    console.log(`🟢 Servidor listo en http://localhost:${PORT}`);
});