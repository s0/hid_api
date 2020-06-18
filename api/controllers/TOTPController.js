const authenticator = require('authenticator');
const Boom = require('@hapi/boom');
const QRCode = require('qrcode');
const BCrypt = require('bcryptjs');
const HelperService = require('../services/HelperService');
const config = require('../../config/env')[process.env.NODE_ENV];

const { logger } = config;

/**
 * @module TOTPController
 * @description Controller for 2FA functions.
 */
module.exports = {

  /*
   * @api [post] /totp/qrcode
   * tags:
   *   - totp
   * summary: Provides configuration for 2FA setup.
   * responses:
   *   '200':
   *     description: >-
   *       The 2FA configuration in two formats: QR code, plaintext.
   *     content:
   *       application/json:
   *         type: object
   *         properties:
   *           url:
   *             type: string
   *             format: byte
   *           raw:
   *             type: string
   *             format: uri
   *   '400':
   *     description: Bad request. See response body for details.
   *   '401':
   *     description: Unauthorized.
   */
  async generateQRCode(request) {
    const user = request.auth.credentials;
    if (user.totp === true) {
      // TOTP is already enabled, user needs to disable it first
      logger.warn('[TOTPController->generateQRCode] 2FA already enabled. Can not generate QRCode.', { security: true, fail: true, request });
      throw Boom.badRequest('You have already enabled 2FA. You need to disable it first');
    }
    const secret = authenticator.generateKey();
    const mfa = {
      secret,
    };
    user.totpConf = mfa;
    await user.save();
    logger.info(
      `[TOTPController->generateQRCode] Saved user ${user.id} with totp secret`,
    );
    let qrCodeName = `HID (${process.env.NODE_ENV})`;
    if (process.env.NODE_ENV === 'production') {
      qrCodeName = 'HID';
    }
    const otpauthUrl = authenticator.generateTotpUri(secret, user.name, qrCodeName, 'SHA1', 6, 30);
    const qrcode = await QRCode.toDataURL(otpauthUrl);
    return {
      url: qrcode,
      raw: otpauthUrl,
    };
  },

  /*
   * @api [post] /totp
   * tags:
   *   - totp
   * summary: Enables 2FA for current user.
   * parameters:
   *   - name: X-HID-TOTP
   *     in: header
   *     description: The TOTP token. Required.
   *     required: false
   *     type: string
   * requestBody:
   *   description: >-
   *     Must be an object specifying: `{"method": "app"}`
   *   required: true
   *   content:
   *     application/json:
   *       schema:
   *         type: object
   *         properties:
   *           method:
   *             type: string
   *             required: true
   *             pattern: '^app$'
   * responses:
   *   '200':
   *     description: The updated user object
   *     content:
   *       application/json:
   *         schema:
   *           $ref: '#/components/schemas/User'
   *   '400':
   *     description: Bad request. See response body for details.
   *   '401':
   *     description: Unauthorized.
   */
  async enable(request) {
    const user = request.auth.credentials;
    if (user.totp === true) {
      // TOTP is already enabled, user needs to disable it first
      logger.warn('[TOTPController->enable] 2FA already enabled. No need to reenable.', { security: true, fail: true, request });
      throw Boom.badRequest('2FA is already enabled. You need to disable it first');
    }
    const method = request.payload ? request.payload.method : '';
    if (method !== 'app' && method !== 'sms') {
      logger.warn(
        `[TOTPController->enable] Invalid 2FA method provided: ${method}`,
      );
      throw Boom.badRequest('Valid 2FA method is required');
    }
    user.totpMethod = request.payload.method;
    user.totp = true;
    await user.save();
    logger.info(
      `[TOTPController->enable] Saved user ${user.id} with 2FA method ${user.totpMethod}`,
    );
    return user;
  },

  /*
   * @api [get] /totp
   * tags:
   *   - totp
   * summary: Verify a TOTP token.
   * parameters:
   *   - name: X-HID-TOTP
   *     in: header
   *     description: The TOTP token. Required.
   *     required: false
   *     type: string
   * responses:
   *   '204':
   *     description: TOTP token is valid.
   *   '401':
   *     description: Unauthorized.
   */
  verifyTOTPToken(request, reply) {
    return reply.response().code(204);
  },

  /*
   * @api [delete] /totp
   * tags:
   *   - totp
   * summary: Disables 2FA for current user.
   * parameters:
   *   - name: X-HID-TOTP
   *     in: header
   *     description: The TOTP token. Required.
   *     required: false
   *     type: string
   * responses:
   *   '200':
   *     description: The updated user object
   *     content:
   *       application/json:
   *         schema:
   *           $ref: '#/components/schemas/User'
   *   '400':
   *     description: Bad request. See response body for details.
   *   '401':
   *     description: Unauthorized.
   */
  async disable(request) {
    const user = request.auth.credentials;
    if (user.totp !== true) {
      // TOTP is already disabled
      logger.warn('[TOTPController->disable] 2FA already disabled.', { security: true, fail: true, request });
      throw Boom.badRequest('2FA is already disabled.');
    }
    user.totp = false;
    user.totpConf = {};
    await user.save();
    logger.info(
      `[TOTPController->disable] Disabled 2FA for user ${user.id}`,
    );
    return user;
  },

  /*
   * @api [post] /totp/device
   * tags:
   *   - totp
   * summary: Save a trusted device for 30 days.
   * parameters:
   *   - name: X-HID-TOTP
   *     in: header
   *     description: The TOTP token. Required.
   *     required: false
   *     type: string
   * responses:
   *   '200':
   *     description: >-
   *       Device was saved successfully. The response contains a secret which
   *       should be provided in the `x-hid-totp-trust` header.
   *   '400':
   *     description: Bad request.
   *   '401':
   *     description: Unauthorized.
   */
  async saveDevice(request, reply) {
    await HelperService.saveTOTPDevice(request, request.auth.credentials);
    logger.info(
      `[TOTPController->saveDevice] Saved new 2FA device for ${request.auth.credentials.id}`,
    );
    const tindex = request.auth.credentials.trustedDeviceIndex(request.headers['user-agent']);
    const { secret } = request.auth.credentials.totpTrusted[tindex];
    return reply.response({ 'x-hid-totp-trust': secret })
      .state('x-hid-totp-trust', secret, {
        ttl: 30 * 24 * 60 * 60 * 1000, domain: 'humanitarian.id', isSameSite: false, isHttpOnly: false,
      });
  },

  /*
   * @api [delete] /totp/device/{id}
   * tags:
   *   - totp
   * summary: Remove trusted device.
   * parameters:
   *   - name: id
   *     in: path
   *     description: The device ID.
   *     required: true
   *     type: string
   * responses:
   *   '204':
   *     description: Successfully deleted trusted device.
   *   '404':
   *     description: The device could not be found.
   */
  async destroyDevice(request, reply) {
    const user = request.auth.credentials;
    const deviceId = request.params.id;
    const device = user.totpTrusted.id(deviceId);
    if (device) {
      user.totpTrusted.id(deviceId).remove();
      await user.save();
      logger.info(
        `[TOTPController->destroyDevice] Removed 2FA device ${deviceId} for ${request.auth.credentials.id}`,
      );
      return reply.response().code(204);
    }
    logger.warn(
      `[TOTPController->destroyDevice] Could not find device ${deviceId} for ${request.auth.credentials.id}`,
    );
    throw Boom.notFound();
  },

  /*
   * @api [post] /totp/codes
   * tags:
   *   - totp
   * summary: Create new backup codes for a 2FA user.
   * responses:
   *   '200':
   *     description: Array of 16 backup codes.
   *     content:
   *       application/json:
   *         schema:
   *           type: array
   *           items:
   *             type: string
   *             pattern: '^[a-f0-9]{10}$'
   *   '400':
   *     description: Bad request. See response body for details.
   *   '401':
   *     description: Unauthorized.
   */
  async generateBackupCodes(request) {
    const user = request.auth.credentials;
    if (!user.totp) {
      logger.warn(
        `[TOTPController->generateBackupCodes] TOTP needs to be enable for user ${request.auth.credentials.id}`,
      );
      throw Boom.badRequest('TOTP needs to be enabled');
    }
    const codes = []; const
      hashedCodes = [];
    for (let i = 0; i < 16; i += 1) {
      codes.push(HelperService.generateRandom());
    }
    for (let i = 0; i < 16; i += 1) {
      hashedCodes.push(BCrypt.hashSync(codes[i], 5));
    }
    // Save the hashed codes in the user and show the ones which are not hashed
    user.totpConf.backupCodes = hashedCodes;
    user.markModified('totpConf');
    await user.save();
    logger.info(
      `[TOTPController->generateBackupCodes] Saved user ${user.id} with new backup codes`,
    );
    return codes;
  },
};
