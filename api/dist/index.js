"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./db");
const auth_1 = __importDefault(require("./routes/auth"));
const endpoints_1 = __importDefault(require("./routes/endpoints"));
const heartbeats_1 = __importDefault(require("./routes/heartbeats"));
const ingest_1 = __importDefault(require("./routes/ingest"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/endpoints', endpoints_1.default);
app.use('/api/heartbeats', heartbeats_1.default);
app.use('/api/ingest', ingest_1.default);
// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Init DB and start
async function start() {
    try {
        await (0, db_1.initDB)();
        console.log('Database initialized');
        app.listen(PORT, () => {
            console.log(`Pantau API running on :${PORT}`);
        });
    }
    catch (err) {
        console.error('Failed to start:', err);
        process.exit(1);
    }
}
start();
exports.default = app;
//# sourceMappingURL=index.js.map