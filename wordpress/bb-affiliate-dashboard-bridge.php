<?php
/**
 * Plugin Name: BB Affiliate Dashboard Bridge
 * Description: Mark referrals paid/unpaid from the external affiliate dashboard without REST API Extended.
 * Install: copy to wp-content/mu-plugins/bb-affiliate-dashboard-bridge.php
 *
 * Add to wp-config.php (same values as dashboard .env AFFWP_PUBLIC_KEY / AFFWP_TOKEN):
 *   define('BB_AFFWP_PUBLIC_KEY', 'your_public_key');
 *   define('BB_AFFWP_TOKEN', 'your_token');
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('bb-affiliate-dashboard/v1', '/referrals/(?P<id>\d+)', [
        'methods'             => ['POST', 'PUT', 'PATCH'],
        'callback'            => 'bb_aff_dash_update_referral',
        'permission_callback' => 'bb_aff_dash_authenticate',
        'args'                => [
            'status' => [
                'required'          => true,
                'type'              => 'string',
                'enum'              => ['paid', 'unpaid', 'pending', 'rejected'],
                'sanitize_callback' => 'sanitize_text_field',
            ],
        ],
    ]);
});

function bb_aff_dash_credentials() {
    if (defined('BB_AFFWP_PUBLIC_KEY') && defined('BB_AFFWP_TOKEN')) {
        return [BB_AFFWP_PUBLIC_KEY, BB_AFFWP_TOKEN];
    }
    return [
        (string) get_option('bb_affwp_public_key', ''),
        (string) get_option('bb_affwp_token', ''),
    ];
}

register_activation_hook(__FILE__, function () {
    if (defined('BB_AFFWP_INSTALL_PUBLIC_KEY') && defined('BB_AFFWP_INSTALL_TOKEN')) {
        update_option('bb_affwp_public_key', BB_AFFWP_INSTALL_PUBLIC_KEY);
        update_option('bb_affwp_token', BB_AFFWP_INSTALL_TOKEN);
    }
});

function bb_aff_dash_authenticate(WP_REST_Request $request) {
    $user = $request->get_header('php_auth_user');
    $pass = $request->get_header('php_auth_pw');

    if (!$user || !$pass) {
        $auth = $request->get_header('authorization');
        if ($auth && preg_match('/^Basic\s+(.+)$/i', $auth, $m)) {
            $decoded = base64_decode($m[1], true);
            if ($decoded !== false && str_contains($decoded, ':')) {
                [$user, $pass] = explode(':', $decoded, 2);
            }
        }
    }

    if (!$user || !$pass) {
        return false;
    }

    [$pub, $tok] = bb_aff_dash_credentials();

    if ($pub && $tok && hash_equals($pub, $user) && hash_equals($tok, $pass)) {
        return true;
    }

    return false;
}

function bb_aff_dash_update_referral(WP_REST_Request $request) {
    if (!function_exists('affwp_set_referral_status')) {
        return new WP_Error('affwp_missing', 'AffiliateWP is not active.', ['status' => 503]);
    }

    $id = (int) $request['id'];
    $status = $request->get_param('status');

    if (!$id) {
        return new WP_Error('invalid_id', 'Invalid referral ID.', ['status' => 400]);
    }

    $referral = affwp_get_referral($id);
    if (!$referral) {
        return new WP_Error('not_found', 'Referral not found.', ['status' => 404]);
    }

    $updated = affwp_set_referral_status($id, $status);
    if (!$updated) {
        return new WP_Error('update_failed', 'Could not update referral status.', ['status' => 400]);
    }

    $ref = affwp_get_referral($id);

    return rest_ensure_response([
        'referral_id'  => (int) $ref->referral_id,
        'affiliate_id' => (int) $ref->affiliate_id,
        'status'       => $ref->status,
        'amount'       => $ref->amount,
        'currency'     => $ref->currency,
        'reference'    => $ref->reference,
        'description'  => $ref->description,
        'date'         => $ref->date,
        'id'           => (int) $ref->referral_id,
    ]);
}
