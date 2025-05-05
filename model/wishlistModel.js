import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  products: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    variantType: { 
      type: String, 
      enum: ['Full option', 'Base'],
      required: true 
    },
    addedAt: { 
      type: Date, 
      default: Date.now 
    }
  }]
}, { timestamps: true });

export default mongoose.model("Wishlist", wishlistSchema);