import Razorpay from 'razorpay';
import { config } from 'dotenv';

// Load environment variables
config();

// Initialize Razorpay with configuration from .env
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

export default razorpay; 