import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "http://localhost:3000/auth/google/callback",
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
}, (accessToken, refreshToken, profile, done) => {
    console.log('Google OAuth callback received');
    console.log('Profile:', profile);
    return done(null, profile);
}));

// Session handling
passport.serializeUser((user, done) => {
    console.log('Serializing user:', user);
    done(null, user);
});

passport.deserializeUser((user, done) => {
    console.log('Deserializing user:', user);
    done(null, user);
});

export default passport;