// server.js - 다크소울 장비 최적화 API
// 부팅 시 방어구 데이터를 DB에서 한 번 읽어 메모리에 올린다.
// 최적화 요청은 DB에 접근하지 않는다 (요청당 수 ms, 1 vCPU 에서도 여유).

"use strict";

const express = require("express");
const pool = require("./db");
const { loadArmor, loadDataVersion } = require("./repo");
const { createEngine } = require("./engine");
const { parseOptimizeQuery } = require("./validate");

const PORT = Number(process.env.PORT) || 3000;

async function withRetry(fn, {tries = 10, delayMs = 2000 }
= {}) {
    for (let i = 0; ; i++){
        try {
            return await fn();
        } catch (e) {
            if (i >= tries) throw e;
            console.warn(`DB 연결 재시도 ${i}/${tries}: ${e.message}`);
            await new Promise((r) => setTimeout(r, delayMs));
        }        
    }
}

async function main() {
    const armors = await withRetry(() => loadArmor(pool));
    const dataVersion = await loadDataVersion(pool);
    if (armors.length === 0) throw new Error("방어구 데이터가 비어있습니다. 시딩을 먼저 ㄱㄱ (npm run seed)");
    const engine = createEngine(armors);
    console.log(`방어구 ${armors.length}개 로딩 완료. 데이터 버전: ${dataVersion}`);

    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({limit: "10kb"}));

    // health check
    app.get("/health", async (req, res) => {
        try {
            await pool.query("SELECT 1");
            res.json({status: "ok", db: "connected", armor: armors.length, data_version: dataVersion});
        } catch {
            res.status(503).json({status: "error", db: "disconnected"});
        }
    });
    
    // 참조 데이터 (메모리에서 응답)
    app.get("/api/armor", (req, res) => {
        const { slot } = req.query;
        const list = slot ? armors.filter((a) => a.slot === slot) : armors;
        res.json({data_version: dataVersion, count: list.length, armors: list});
    });

    // 최적화 (not DB)
    app.post("/api/optimize", (req, res) => {
        const {errors, query} = parseOptimizeQuery(req.body);
        if (errors) return res.status(400).json({errors});
        const t0 = process.hrtime.bigint();
        const result = engine.optimize(query);
        const tookMs = Number(process.hrtime.bigint() - t0) / 1e6;
        res.json({...result, query, data_version: dataVersion, took_ms: Math.round(tookMs * 100) / 100});
    });

    // Wrong json : 400
    app.use((err, req, res, next) => {
        if (err.type === "entity.parse.failed") return res.status(400).json({errors: ["JSON 형식이 잘못되었습니다"]});
        if (err.type === "entity.too.large") return res.status(413).json({errors: ["요청 본문이 너무 큽니다"]});
        console.error("에러발생:", err.message);
        res.status(500).json({errors: ["서버 내부 오류"]});
    });

    const server = app.listen(PORT, () =>
        console.log(`souls 서버 실행 중: http://localhost:${PORT}`));

    // docker stop 은 SIGTERM 을 보낸다. 처리 중인 요청을 끝내고 연결을 닫는다.
    const shutdown = (sig) => {
        console.log(`\n${sig} 수신, 종료합니다`);
        server.close(() => pool.end().then(() => process.exit(0)));
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

main().catch((e) => {
    console.error("부팅 실패:", e.message);
    process.exit(1);
});