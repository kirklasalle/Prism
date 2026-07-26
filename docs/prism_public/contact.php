<?php
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit;
}

$name = trim($_POST['name'] ?? '');
$email = trim($_POST['email'] ?? '');
$subject = trim($_POST['subject'] ?? '');
$message = trim($_POST['message'] ?? '');
$honeypot = trim($_POST['company_website'] ?? '');
$formToken = trim($_POST['form_token'] ?? '');

if ($honeypot !== '') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid submission']);
    exit;
}

if ($formToken !== 'PRISM_SITE_CONTACT_V1') {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid form token']);
    exit;
}

if ($name === '' || $subject === '' || $message === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'message' => 'Please complete all required fields']);
    exit;
}

$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$ua = $_SERVER['HTTP_USER_AGENT'] ?? 'unknown';
$timestamp = gmdate('c');

$maxLen = 4000;
if (strlen($message) > $maxLen) {
    http_response_code(422);
    echo json_encode(['ok' => false, 'message' => 'Message is too long']);
    exit;
}

$to = getenv('PRISM_CONTACT_EMAIL') ?: 'security@prismrefraction.com';
$mailSubject = '[Prism Contact] ' . preg_replace('/[\r\n]+/', ' ', $subject);
$body = "Timestamp: {$timestamp}\n"
    . "Name: {$name}\n"
    . "Email: {$email}\n"
    . "IP: {$ip}\n"
    . "User-Agent: {$ua}\n\n"
    . "Message:\n{$message}\n";

$headers = [
    'From: noreply@prismrefraction.com',
    'Reply-To: ' . $email,
    'X-Prism-Contact: WebsiteForm',
];

$mailSent = @mail($to, $mailSubject, $body, implode("\r\n", $headers));

$logDir = __DIR__ . '/logs';
if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
}

$logLine = json_encode([
    'timestamp' => $timestamp,
    'name' => $name,
    'email' => $email,
    'subject' => $subject,
    'ip' => $ip,
    'mailSent' => $mailSent,
], JSON_UNESCAPED_SLASHES);

@file_put_contents($logDir . '/contact-submissions.log', $logLine . PHP_EOL, FILE_APPEND | LOCK_EX);

if (!$mailSent) {
    http_response_code(202);
    echo json_encode([
        'ok' => true,
        'message' => 'Submission recorded. Email relay pending; the team will still review your request.',
    ]);
    exit;
}

echo json_encode([
    'ok' => true,
    'message' => 'Transmission received. A team member will follow up shortly.',
]);
