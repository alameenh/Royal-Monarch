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
  cookie: { 
    maxAge: 1000 * 60 * 60 * 24, // 1 day
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
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
    
    // Check if the request expects JSON
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(500).json({
            success: false,
            message: 'An internal server error occurred'
        });
    }
    
    // For regular requests, render the error page
    res.status(500).render('error', {
        message: 'An internal server error occurred',
        currentPage: ''
    });
});

// Add 404 handler for undefined routes
app.use((req, res) => {
    // Check if the request expects JSON
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(404).json({
            success: false,
            message: 'Page not found'
        });
    }
    
    // For regular requests, render the error page
    res.status(404).render('error', {
        message: 'Page not found',
        currentPage: ''
    });
});

app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
 