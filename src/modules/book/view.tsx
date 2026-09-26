/**
 * iOS only opens the Fresha app from a link the user taps, never from a
 * redirect, so iPhones land here and tap through instead of being 302'd.
 */
export const openInFreshaPage = (url: string) => (
	<html lang="es">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>Abrir en Fresha</title>
		</head>
		<body
			style={{
				margin: 0,
				minHeight: "100vh",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				fontFamily: "-apple-system, system-ui, sans-serif",
				background: "#fff",
				color: "#111",
			}}
		>
			<main style={{ textAlign: "center", padding: "24px" }}>
				<a
					href={url}
					style={{
						display: "inline-block",
						padding: "16px 32px",
						borderRadius: "12px",
						background: "#111",
						color: "#fff",
						fontSize: "18px",
						fontWeight: 600,
						textDecoration: "none",
					}}
				>
					Abrir en Fresha
				</a>
				<p style={{ color: "#666", fontSize: "14px" }}>
					Tu hora te espera en el carrito.
				</p>
			</main>
		</body>
	</html>
);
