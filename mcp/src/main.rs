use tokio::io::BufReader;
use veluna_mcp::server::serve_stdio;

#[tokio::main]
async fn main() {
    eprintln!("[veluna-mcp] starting MCP server v{} on stdio", env!("CARGO_PKG_VERSION"));
    let stdin = BufReader::new(tokio::io::stdin());
    let stdout = tokio::io::stdout();
    if let Err(err) = serve_stdio(stdin, stdout).await {
        eprintln!("[veluna-mcp] fatal transport error: {err}");
        std::process::exit(1);
    }
}
