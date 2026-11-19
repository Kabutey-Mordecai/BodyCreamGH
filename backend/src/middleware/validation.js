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
  delivery_fee:     Joi.number().min(0).default(0),
  coupon_code:      Joi.string().trim().max(50).optional().allow('', null),
  notes:            Joi.string().trim().max(1000).optional().allow('', null),
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
  delivery_fee:     Joi.number().min(0).default(0),
  coupon_code:      Joi.string().trim().max(50).optional().allow('', null),
  notes:            Joi.string().trim().max(1000).optional().allow('', null),
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
  delivery_partner:   Joi.string().trim().max(100).optional().allow('', null),
  tracking_number:    Joi.string().trim().max(100).optional().allow('', null),
  estimated_delivery: Joi.string().isoDate().optional().allow('', null),
  driver_phone:       Joi.string().trim().max(30).optional().allow('', null),
});

const updateDeliverySchema = Joi.object({
  status: Joi.string().valid('pending', 'in_transit', 'out_for_delivery', 'delivered').optional(),
  tracking_number:       Joi.string().trim().max(100).optional().allow('', null),
  estimated_delivery:    Joi.string().isoDate().optional().allow('', null),
  actual_delivery_date:  Joi.string().isoDate().optional().allow('', null),
  driver_phone:          Joi.string().trim().max(30).optional().allow('', null),
  delivery_partner:      Joi.string().trim().max(100).optional().allow('', null),
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

// Product validation for both POST /products and PUT /products/:id
const validateProduct = (req, res, next) => {
  const errors = [];
  const body = req.body || {};
  const isUpdate = req.method === 'PUT' || req.method === 'PATCH';

  // 1. name: trim, non-empty, max 200 chars
  if (!isUpdate || body.name !== undefined) {
    if (body.name === undefined || body.name === null || typeof body.name !== 'string' || body.name.trim() === '') {
      errors.push({ field: 'name', message: 'Product name is required and cannot be empty.' });
    } else {
      const trimmedName = body.name.trim();
      if (trimmedName.length > 200) {
        errors.push({ field: 'name', message: 'Product name must not exceed 200 characters.' });
      } else {
        req.body.name = trimmedName;
      }
    }
  }

  // 2. price: numeric, > 0
  if (!isUpdate || body.price !== undefined) {
    if (body.price === undefined || body.price === null || body.price === '' || isNaN(body.price) || Number(body.price) <= 0) {
      errors.push({ field: 'price', message: 'Price must be a positive number.' });
    } else {
      req.body.price = Number(body.price);
    }
  }

  // 3. cost: if provided and not null/"", must be numeric and >= 0. Empty -> null (create only defaults to null)
  if (body.cost !== undefined) {
    if (body.cost === null || body.cost === '') {
      req.body.cost = null;
    } else {
      const costNum = Number(body.cost);
      if (isNaN(costNum) || costNum < 0) {
        errors.push({ field: 'cost', message: 'Cost must be a numeric value greater than or equal to 0.' });
      } else {
        req.body.cost = costNum;
      }
    }
  } else if (!isUpdate) {
    req.body.cost = null;
  }

  // 4. stock_quantity: if provided, must be an integer >= 0 (create only defaults to 0)
  if (body.stock_quantity !== undefined) {
    if (body.stock_quantity === null || body.stock_quantity === '') {
      req.body.stock_quantity = 0;
    } else {
      const sqNum = Number(body.stock_quantity);
      if (isNaN(sqNum) || !Number.isInteger(sqNum) || sqNum < 0) {
        errors.push({ field: 'stock_quantity', message: 'Stock quantity must be an integer greater than or equal to 0.' });
      } else {
        req.body.stock_quantity = sqNum;
      }
    }
  } else if (!isUpdate) {
    req.body.stock_quantity = 0;
  }

  // 5. compare_at_price: if provided and > 0, must be numeric and > price. Empty/0 -> null
  if (body.compare_at_price !== undefined) {
    if (body.compare_at_price === null || body.compare_at_price === '' || Number(body.compare_at_price) === 0) {
      req.body.compare_at_price = null;
    } else {
      const capNum = Number(body.compare_at_price);
      if (isNaN(capNum)) {
        errors.push({ field: 'compare_at_price', message: 'Compare at price must be a valid number.' });
      } else if (capNum < 0) {
        errors.push({ field: 'compare_at_price', message: 'Compare at price must be greater than 0.' });
      } else if (req.body.price !== undefined && capNum <= req.body.price) {
        errors.push({ field: 'compare_at_price', message: 'Compare at price must be greater than the selling price.' });
      } else {
        req.body.compare_at_price = capNum;
      }
    }
  } else if (!isUpdate) {
    req.body.compare_at_price = null;
  }

  // 6. sku: trim; empty string -> null
  if (body.sku !== undefined) {
    if (body.sku === null) {
      req.body.sku = null;
    } else {
      const trimmedSku = String(body.sku).trim();
      req.body.sku = trimmedSku === '' ? null : trimmedSku;
    }
  } else if (!isUpdate) {
    req.body.sku = null;
  }

  // 7. category: trim; normalize to Title Case per word ("body cream" -> "Body Cream", "SPF Sunscreen" stays); empty -> null
  if (body.category !== undefined) {
    if (body.category === null) {
      req.body.category = null;
    } else {
      const trimmedCat = String(body.category).trim();
      if (trimmedCat === '') {
        req.body.category = null;
      } else {
        req.body.category = trimmedCat
          .split(/\s+/)
          .map(w => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');
      }
    }
  } else if (!isUpdate) {
    req.body.category = null;
  }

  // 8. is_active: coerce to boolean if provided
  if (body.is_active !== undefined) {
    req.body.is_active = (body.is_active === true || body.is_active === 'true' || body.is_active === 1 || body.is_active === '1');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      errors,
    });
  }

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
