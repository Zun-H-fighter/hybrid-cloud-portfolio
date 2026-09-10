// index.js - Express 서버 + TODO CRUD API
const express = require("express");
const pool = require("./db");

const app = express();
app.use(express.json()); // JSON 요청 본문 파싱
app.use(express.static("public")); //퍼블릭 폴더 정적 서빙

// 서버 시작 시 테이블 없으면 생성
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
            id SERIAL PRIMARY KEY,
            title TEXT NOT NULL, 
            done BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    `);
    console.log("DB 준비 완료오옹");
}
    
//서버 헬스 체크 + DB 연결까지 추가
app.get("/health", async (req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", db: "connected" });
    } catch (err) {
        res.status(503).json({status: "error", db: "disconnected" });
    }
});

//[조회] 전체 할 일 목록
app.get("/todos", async (req, res, next) => {
    try {
        const result = await pool.query("SELECT * FROM todos ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// [생성] 새 할 일 추가
app.post("/todos", async(req, res, next) => {
    try {
        const { title } = req.body;
        if(!title) return res.status(400).json({ error: "title이 필요합니다"});
        const result = await pool.query(
            "INSERT INTO todos (title) VALUES ($1) RETURNING *",
            [title]
        );
        res.status(201).json(result.rows[0]);
    } catch (err){
        next(err);
    }
});

//[수정] 특정 할 일 업뎃 (제목 또는 완료 여부)
app.put("/todos/:id", async (req, res, next) => {
    try {
        const { id } = req.params;
        const { title, done } = req.body;
        const result = await pool.query(
            `UPDATE todos
            SET title = COALESCE($1, title),
                done  = COALESCE($2, done)
            WHERE id = $3
            RETURNING *`,
            [title, done, id]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ error: "해당 할 일을 못 찾았어요"});
        res.json(result.rows[0]);
    } catch (err){
        next(err);
    }
});

//[삭제] 특정 할 일 삭제
app.delete("/todos/:id", async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "DELETE FROM todos WHERE id = $1 RETURNING *",
            [id]
        );
        if (result.rows.length === 0)
            return res.status(404).json({ error: "해당 할 일을 찾을 수 없습니다" });
        res.json({ message: "삭제되었어용", deleted: result.rows[0] });
    } catch (err){
        next(err);
    }
});

//에러 핸들러
app.use((err, req, res, next) =>{
    console.error("에러 발생:", err.message);
    res.status(500).json({ error: "서버 내부 오류 발생!!!" });
});

const PORT = process.env.PORT || 3000;
initDB().then(() => {
    app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));  
});

