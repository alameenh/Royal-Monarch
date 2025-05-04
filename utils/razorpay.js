import Razorpay from 'razorpay';
import { config } from 'dotenv';

// Load environment variables
config();

// Get and validate Razorpay credentials
const getRazorpayCredentials = () => {
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;

    if (!key_id || !key_secret) {
        throw new Error('Razorpay credentials are missing in environment variables');
    }

    // Remove any whitespace and validate format
    const cleanKeyId = key_id.trim();
    const cleanKeySecret = key_secret.trim();

    if (!cleanKeyId.startsWith('rzp_')) {
        throw new Error('Invalid Razorpay Key ID format');
    }

    return {
        key_id: cleanKeyId,
        key_secret: cleanKeySecret
    };
};

// Initialize Razorpay with validated credentials
const credentials = getRazorpayCredentials();
const razorpay = new Razorpay(credentials);

// Export a function to verify the configuration
export const verifyRazorpayConfig = async () => {
    try {
        // Test the configuration with a minimal order
        await razorpay.orders.create({
            amount: 100,
            currency: 'INR',
            receipt: 'test_receipt'
        });
        return true;
    } catch (error) {
        console.error('Razorpay configuration test failed:', error);
        throw new Error(`Failed to initialize Razorpay: ${error.message}`);
    }
};

export default razorpay; 