import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
    otpValue: {
        type: String,
       
    },
    otpExpiresAt: {
        type: Date,
    },
    otpAttempts: {
        type: Number,
        default: 0,
    },
});

const userSchema = new mongoose.Schema(
    {
        firstname: {
            type: String,
            required: true,
        },
        lastname: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
        },
        googleId: {
            type: String,
        },
        password: {
            type: String,
        },
        status: {
            type: String,
            enum: ["Pending", "Active", "Blocked"],
        },
        otp: otpSchema,
        
		referralCode : {
			type: String,
			unique: true 
		}
    },
    { timestamps: true }
);

export default mongoose.model("users", userSchema);