import express from "express";
import connectDb from "./db/connection.js";
import session from "express-session";
import nocache from "nocache";
import {config} from "dotenv";
import adminRoutes from "./routes/adminRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import './utils/googleAuth.js';
import passport from "passport";

config();

const app = express();
const PORT = process.env.PORT;

app.use(nocache());

//static assets
app.use(express.static('public'))
app.set("view engine", "ejs");

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
}));

// Increase payload size limit significantly
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

app.use('/',userRoutes);
app.use('/admin',adminRoutes);

connectDb();

// Add this before app.listen
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({
        success: false,
        message: 'An internal server error occurred'
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
 