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

app.use(express.json());
app.use(express.urlencoded({extended:true}));

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());


app.use('/',userRoutes);
app.use('/admin',adminRoutes);


connectDb();

 
app.listen(PORT, () => {
  console.log(`Server is running on ${PORT}`);
});
 