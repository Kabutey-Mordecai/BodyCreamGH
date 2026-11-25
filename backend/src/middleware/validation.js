const Joi = require('joi');

function validate(schema, property = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], { abortEarly: false, stripUnknown: true });
    if (error) {
      const messages = error.details.map(d => d.message);
      return res.status(400).json({ error: messages.join('; ') });
    }
    req[property] = value;
    next();
  };
}

const passwordSchema = Joi.string().min(8).max(128).required();

const registerSchema = Joi.object({
  email:      Joi.string().email().max(254).required(),
  password:   passwordSchema,
  first_name: Joi.string().trim().min(1).max(100).required(),
  last_name:  Joi.string().trim().min(1).max(100).required(),
  phone:      Joi.string().trim().max(30).optional().allow('', null),
});

const loginSchema = Joi.object({
  email:    Joi.string().email().required(),
  password: Joi.string().required(),
});

const createOrderSchema = Joi.object({
  fulfillment_method: Joi.string().valid('delivery', 'pickup').default('delivery'),
  payment_method:     Joi.string().valid('paystack', 'pay_on_delivery').default('paystack'),
  shipping_address: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(500).optional().allow('', null),
    otherwise: Joi.string().trim().min(3).max(500).required(),
  }),
  shipping_city: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(100).optional().allow('', null),
    otherwise: Joi.string().trim().min(1).max(100).required(),
  }),
  shipping_region: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(100).optional().allow('', null),
    otherwise: Joi.string().trim().min(1).max(100).required(),
  }),
  delivery_fee:      Joi.number().min(0).default(0),
  ghana_post_gps:    Joi.string().trim().uppercase().pattern(/^[A-Z]{2}-\d{3,4}-\d{4}$/).optional().allow('', null)
    .messages({ 'string.pattern.base': 'GhanaPostGPS must be in the format GA-183-9024' }),
  delivery_landmark: Joi.string().trim().max(300).optional().allow('', null),
  coupon_code:       Joi.string().trim().max(50).optional().allow('', null),
  notes:             Joi.string().trim().max(1000).optional().allow('', null),
});

const createGuestOrderSchema = Joi.object({
  fulfillment_method: Joi.string().valid('delivery', 'pickup').default('delivery'),
  payment_method:     Joi.string().valid('paystack', 'pay_on_delivery').default('paystack'),
  email:            Joi.string().email().max(254).required(),
  first_name:       Joi.string().trim().min(1).max(100).required(),
  last_name:        Joi.string().trim().max(100).optional().allow('', null),
  phone:            Joi.string().trim().min(5).max(30).required(),
  shipping_address: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(500).optional().allow('', null),
    otherwise: Joi.string().trim().min(3).max(500).required(),
  }),
  shipping_city: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(100).optional().allow('', null),
    otherwise: Joi.string().trim().min(1).max(100).required(),
  }),
  shipping_region: Joi.when('fulfillment_method', {
    is: 'pickup',
    then: Joi.string().trim().max(100).optional().allow('', null),
    otherwise: Joi.string().trim().min(1).max(100).required(),
  }),
  delivery_fee:      Joi.number().min(0).default(0),
  ghana_post_gps:    Joi.string().trim().uppercase().pattern(/^[A-Z]{2}-\d{3,4}-\d{4}$/).optional().allow('', null)
    .messages({ 'string.pattern.base': 'GhanaPostGPS must be in the format GA-183-9024' }),
  delivery_landmark: Joi.string().trim().max(300).optional().allow('', null),
  coupon_code:       Joi.string().trim().max(50).optional().allow('', null),
  notes:             Joi.string().trim().max(1000).optional().allow('', null),
  items: Joi.array().items(
    Joi.object({
      product_id:    Joi.string().uuid().required(),
      quantity:      Joi.number().integer().min(1).required(),
      variant_id:    Joi.string().uuid().optional().allow(null),
      variant_label: Joi.string().trim().max(200).optional().allow('', null),
    })
  ).min(1).required(),
});

const createDeliverySchema = Joi.object({
  order_id:           Joi.string().uuid().required(),
  delivery_partner:   Joi.string().trim().max(120).optional().allow('', null),
  tracking_number:    Joi.string().trim().max(100).optional().allow('', null),
  estimated_delivery: Joi.string().isoDate().optional().allow('', null),
  driver_phone:       Joi.string().trim().max(40).optional().allow('', null),
});

const updateDeliverySchema = Joi.object({
  status: Joi.string().valid('pending', 'in_transit', 'out_for_delivery', 'delivered').optional(),
  tracking_number:       Joi.string().trim().max(100).optional().allow('', null),
  estimated_delivery:    Joi.string().isoDate().optional().allow('', null),
  actual_delivery_date:  Joi.string().isoDate().optional().allow('', null),
  driver_phone:          Joi.string().trim().max(40).optional().allow('', null),
  delivery_partner:      Joi.string().trim().max(120).optional().allow('', null),
});

const updateOrderStatusSchema = Joi.object({
  status: Joi.string()
    .valid('pending', 'confirmed', 'processing', 'shipped', 'delivered')
    .required(),
  note: Joi.string().trim().max(500).optional().allow('', null),
});

const cancelOrderSchema = Joi.object({
  reason: Joi.string().trim().max(500).optional().allow('', null),
});

const refundOrderSchema = Joi.object({
  method: Joi.string().valid('paystack', 'manual').required(),
  reference: Joi.when('method', {
    is: 'manual',
    then: Joi.string().trim().max(255).required(),
    otherwise: Joi.string().trim().max(255).optional().allow('', null),
  }),
  notes: Joi.string().trim().max(1000).optional().allow('', null),
});

const requestCancelSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});

const requestReturnSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required(),
});

const validateRegister      = validate(registerSchema);
const validateLogin         = validate(loginSchema);
const validateCreateOrder   = validate(createOrderSchema);
const validateCreateGuest   = validate(createGuestOrderSchema);
const validateCreateDelivery  = validate(createDeliverySchema);
const validateUpdateDelivery  = validate(updateDeliverySchema);
const validateOrderStatus     = validate(updateOrderStatusSchema);
const validateCancelOrder     = validate(cancelOrderSchema);
const validateRefundOrder     = validate(refundOrderSchema);
const validateRequestCancel   = validate(requestCancelSchema);
const validateRequestReturn   = validate(requestReturnSchema);

// Legacy — kept for backward compat with product routes
const validateProduct = (req, res, next) => {
  const { name, price } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Product name and price are required' });
  if (isNaN(price) || price <= 0) return res.status(400).json({ error: 'Price must be a positive number' });
  next();
};

module.exports = {
  validateRegister,
  validateLogin,
  validateCreateOrder,
  validateCreateGuest,
  validateCreateDelivery,
  validateUpdateDelivery,
  validateOrderStatus,
  validateCancelOrder,
  validateRefundOrder,
  validateRequestCancel,
  validateRequestReturn,
  validateProduct,
};
