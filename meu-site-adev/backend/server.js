// backend/server.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = 3000;
// CORREÇÃO CRÍTICA: Usar o nome do serviço 'n8n' do Docker, e não 'localhost'
const N8N_WEBHOOK_URL = "http://n8n:5678/webhook/ec162464-ac2c-457a-90d2-a7a6bc5175b2"; 
const ADMIN_PASSWORD = "12345"; // <-- Lembre-se de trocar por uma senha segura!

app.use(cors());
app.use(express.json());

// Rota para a raiz da API, apenas para teste
app.get('/', (req, res) => {
  res.status(200).send('<h1>Backend da ADEVV está no ar!</h1>');
});

// Conexão #1: Banco de dados para os cadastros de visitantes
const db_cadastros = new sqlite3.Database('./data/cadastros.db', (err) => {
  if (err) {
    console.error("Erro ao abrir o banco de dados de cadastros:", err.message);
  } else {
    console.log("Conectado ao banco de dados 'cadastros.db'.");
    db_cadastros.run(`CREATE TABLE IF NOT EXISTS visitantes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      whatsapp TEXT,
      age INTEGER,
      birthdate TEXT,
      maritalStatus TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
});

// Conexão #2: Banco de dados para a programação da igreja
const db_programacao = new sqlite3.Database('./data/programacao.db', (err) => {
    if (err) {
      console.error("Erro ao abrir o banco de dados de programação:", err.message);
    } else {
      console.log("Conectado ao banco de dados 'programacao.db'.");
      db_programacao.serialize(() => {
          db_programacao.run(`CREATE TABLE IF NOT EXISTS cultos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, dia TEXT NOT NULL, horario TEXT NOT NULL)`);
          db_programacao.run(`CREATE TABLE IF NOT EXISTS eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, data TEXT NOT NULL, descricao TEXT)`);
      });
    }
});

// ROTA DE CADASTRO
app.post('/cadastro', (req, res) => {
    const { name, whatsapp, age, birthdate, maritalStatus } = req.body;
    const cleanWhatsapp = whatsapp.replace(/\D/g, '');
    const checkSql = `SELECT * FROM visitantes WHERE REPLACE(REPLACE(REPLACE(REPLACE(whatsapp, '(', ''), ')', ''), '-', ''), ' ', '') = ?`;

    db_cadastros.get(checkSql, [cleanWhatsapp], (err, row) => {
        if (err) {
            console.error("Erro ao verificar o banco de dados:", err.message);
            return res.status(500).json({ error: "Erro interno do servidor." });
        }

        if (row) {
            console.log(`Tentativa de cadastro duplicado para o número: ${whatsapp}`);
            return res.status(409).json({ error: "Este número de WhatsApp já foi cadastrado." });
        }

        const insertSql = `INSERT INTO visitantes (name, whatsapp, age, birthdate, maritalStatus) VALUES (?, ?, ?, ?, ?)`;
        db_cadastros.run(insertSql, [name, whatsapp, age, birthdate, maritalStatus], function(err) {
            if (err) { 
                console.error("Erro ao salvar no banco de dados:", err.message); 
                return res.status(500).json({ error: "Não foi possível salvar o cadastro." });
            } 
            
            console.log(`Novo visitante cadastrado (ID: ${this.lastID}):`, { name, whatsapp });

            axios.post(N8N_WEBHOOK_URL, req.body).catch(error => {
                console.error("Erro ao enviar para o webhook do n8n:", error.message);
            });

            res.status(200).json({ message: "Cadastro realizado com sucesso!" });
        });
    });
});

// API para a página de programação
app.get('/programacao', (req, res) => {
    const data = {};
    db_programacao.all("SELECT * FROM cultos ORDER BY id", [], (err, rows) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        data.cultos = rows;
        db_programacao.all("SELECT * FROM eventos ORDER BY id", [], (err, rows) => {
            if (err) { res.status(500).json({ error: err.message }); return; }
            data.eventos = rows;
            res.json(data);
        });
    });
});

// Middleware de autenticação para admin
function checkAdmin(req, res, next) {
    const password = req.headers['x-admin-password'];
    if (password === ADMIN_PASSWORD) {
        next();
    } else {
        res.status(403).json({ error: "Acesso negado. Senha de admin inválida." });
    }
}

// Rotas de admin
app.post('/admin/cultos', checkAdmin, (req, res) => {
    const { nome, dia, horario } = req.body;
    db_programacao.run(`INSERT INTO cultos (nome, dia, horario) VALUES (?, ?, ?)`, [nome, dia, horario], function(err) {
        if (err) { res.status(400).json({ error: err.message }); return; }
        res.json({ id: this.lastID });
    });
});

app.delete('/admin/cultos/:id', checkAdmin, (req, res) => {
    db_programacao.run(`DELETE FROM cultos WHERE id = ?`, req.params.id, function(err) {
        if (err) { res.status(400).json({ error: err.message }); return; }
        res.json({ changes: this.changes });
    });
});

app.post('/admin/eventos', checkAdmin, (req, res) => {
    const { nome, data, descricao } = req.body;
    db_programacao.run(`INSERT INTO eventos (nome, data, descricao) VALUES (?, ?, ?)`, [nome, data, descricao], function(err) {
        if (err) { res.status(400).json({ error: err.message }); return; }
        res.json({ id: this.lastID });
    });
});

app.delete('/admin/eventos/:id', checkAdmin, (req, res) => {
    db_programacao.run(`DELETE FROM eventos WHERE id = ?`, req.params.id, function(err) {
        if (err) { res.status(400).json({ error: err.message }); return; }
        res.json({ changes: this.changes });
    });
});

// Iniciar o Servidor
app.listen(PORT, () => {
  console.log(`Backend rodando na porta ${PORT}`);
});