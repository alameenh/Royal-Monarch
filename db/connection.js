import mongoose from "mongoose"
import dotenv from "dotenv"

dotenv.config()

const connectDb = async () => {
    try {
        const connection = await mongoose.connect(process.env.MONGOURL,{})
        console.log("DB STATUS", "connected successfully")

    } catch (error) {
        console.log("DB STATUS", error)
    }
}

export default connectDb