import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  variantType: {
    type: String,
    required: true,
 
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    max: 4,
    default: 1
  }
}, { timestamps: true });

// Simple index for query performance
cartItemSchema.index({ userId: 1 });


const CartItem = mongoose.model('CartItem', cartItemSchema);

export default CartItem;