//! User-triggered NCBI submission; sequence data is sent only on Submit.
use serde::{Deserialize, Serialize};
use std::{
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::State;
const ENDPOINT: &str = "https://blast.ncbi.nlm.nih.gov/Blast.cgi";
#[derive(Default)]
pub struct BlastState(Mutex<Option<Instant>>);
impl BlastState {
    fn reserve(&self) -> Result<(), String> {
        let mut last = self
            .0
            .lock()
            .map_err(|_| "BLAST request state is unavailable.")?;
        if last.is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
            return Err(
                "NCBI requires at least 10 seconds between requests. Wait before submitting again."
                    .into(),
            );
        }
        *last = Some(Instant::now());
        Ok(())
    }
}
#[derive(Deserialize)]
pub struct Query {
    sequence: String,
    program: String,
    database: String,
    email: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Submitted {
    rid: String,
    estimated_seconds: Option<u64>,
}
fn form(q: &Query) -> Result<Vec<(&str, String)>, String> {
    let (alphabet, min, max, databases) = match q.program.as_str() {
        "blastn" => ("ACGTRYSWKMBDHVN", 7, 50000, &["core_nt", "refseq_rna"][..]),
        "blastp" => (
            "ACDEFGHIKLMNPQRSTVWYBXZJUO",
            6,
            20000,
            &["nr", "swissprot", "pdb"][..],
        ),
        _ => return Err("Choose BLASTn for DNA or BLASTp for protein.".into()),
    };
    if q.sequence.len() < min
        || q.sequence.len() > max
        || !q.sequence.bytes().all(|b| alphabet.as_bytes().contains(&b))
        || !q.sequence.bytes().any(|b| {
            if q.program == "blastn" {
                b"ACGT".contains(&b)
            } else {
                b"ACDEFGHIKLMNPQRSTVWY".contains(&b)
            }
        })
        || !databases.contains(&q.database.as_str())
    {
        return Err("Invalid BLAST query or database. Review the sequence and selection.".into());
    }
    if q.email.len() > 254
        || q.email.chars().any(char::is_whitespace)
        || (!q.email.is_empty() && (!q.email.contains('@') || q.email.contains(['<', '>'])))
    {
        return Err("Enter a valid optional contact email.".into());
    }
    let mut values = vec![
        ("CMD", "Put".into()),
        ("PROGRAM", q.program.clone()),
        ("DATABASE", q.database.clone()),
        ("QUERY", format!(">PlasmidCraft_query\n{}", q.sequence)),
        ("HITLIST_SIZE", "50".into()),
        ("SHORT_QUERY_ADJUST", "true".into()),
        ("tool", "PlasmidCraft".into()),
    ];
    if !q.email.is_empty() {
        values.push(("email", q.email.clone()));
    }
    Ok(values)
}
fn identifier(rid: &str) -> bool {
    (1..=64).contains(&rid.len())
        && rid
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'-')
}
fn parse(text: &str) -> Result<Submitted, String> {
    let value = |key: &str| {
        text.lines()
            .filter_map(|l| l.trim().split_once('='))
            .find(|(k, _)| k.trim() == key)
            .map(|(_, v)| v.trim())
    };
    let rid=value("RID").filter(|r|identifier(r)).ok_or("NCBI did not return a valid request ID. The search may have been rejected or the service may be unavailable; no automatic resubmission was made.")?;
    Ok(Submitted {
        rid: rid.into(),
        estimated_seconds: value("RTOE").and_then(|v| v.parse().ok()),
    })
}
async fn submit_to(
    client: &reqwest::Client,
    endpoint: &str,
    q: &Query,
) -> Result<Submitted, String> {
    let values = form(q)?;
    let mut response=client.post(endpoint).form(&values).send().await.map_err(|_|"Unable to reach NCBI BLAST. Check your internet connection; a firewall or temporary NCBI outage may also be responsible. If the request timed out, submission status is unknown; do not automatically resubmit.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("NCBI BLAST returned HTTP {}. Check internet access and try later; no automatic resubmission was made.",response.status().as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| {
        "NCBI connection was interrupted. Check internet access; submission status is unknown."
    })? {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err("NCBI returned an unexpectedly large response.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse(std::str::from_utf8(&bytes).map_err(|_| "NCBI returned invalid text.")?)
}
#[tauri::command]
pub async fn blast_submit(query: Query, state: State<'_, BlastState>) -> Result<Submitted, String> {
    form(&query)?;
    state.reserve()?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(60))
        .user_agent("PlasmidCraft/0.11 (interactive BLAST)")
        .build()
        .map_err(|_| "Cannot initialize the NCBI connection.")?;
    submit_to(&client, ENDPOINT, &query).await
}
#[tauri::command]
pub fn blast_open_results(rid: String) -> Result<(), String> {
    if !identifier(&rid) {
        return Err("Invalid NCBI request ID.".into());
    }
    crate::ai::open_url(&format!("{ENDPOINT}?CMD=Get&FORMAT_TYPE=HTML&RID={rid}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn submissions_observe_ncbi_request_spacing() {
        let state = BlastState::default();
        assert!(state.reserve().is_ok());
        assert!(state.reserve().is_err());
        *state.0.lock().unwrap() = Some(Instant::now() - Duration::from_secs(11));
        assert!(state.reserve().is_ok());
    }
    #[test]
    fn requests_validate_before_transport_and_do_not_send_document_metadata() {
        let mut q = Query {
            sequence: "ACGTACGT".into(),
            program: "blastn".into(),
            database: "core_nt".into(),
            email: String::new(),
        };
        let v = form(&q).unwrap();
        assert!(v.contains(&("QUERY", ">PlasmidCraft_query\nACGTACGT".into())));
        q.database = "evil&QUERY=other".into();
        assert!(form(&q).is_err());
        q.database = "core_nt".into();
        q.sequence = "<script>".into();
        assert!(form(&q).is_err());
        assert!(!identifier("ABC&QUERY=secret"));
        assert!(!identifier("https://example.com"));
        assert!(identifier("SYNTHETIC-123"));
    }
    #[test]
    fn ncbi_reply_is_parsed_as_data_never_html() {
        let r = parse("<html>\n RID = SYNTHETIC123\n RTOE = 20\n</html>").unwrap();
        assert_eq!(r.rid, "SYNTHETIC123");
        assert_eq!(r.estimated_seconds, Some(20));
        assert!(parse("RID = <script>").is_err());
        assert!(parse("NCBI failure").is_err());
    }
    #[tokio::test]
    async fn native_blast_posts_to_local_mock_and_handles_connection_failure() {
        use tokio::{
            io::{AsyncReadExt, AsyncWriteExt},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut data = Vec::new();
            let mut buffer = [0; 4096];
            loop {
                let n = s.read(&mut buffer).await.unwrap();
                data.extend_from_slice(&buffer[..n]);
                let text = String::from_utf8_lossy(&data);
                if text.contains("QUERY=") {
                    break;
                }
            }
            let request = String::from_utf8(data).unwrap();
            assert!(request.contains("CMD=Put"));
            assert!(request.contains("DATABASE=core_nt"));
            assert!(!request.contains("Authorization:"));
            let body = "RID = SYNTHETIC123\nRTOE = 2\n";
            s.write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .as_bytes(),
            )
            .await
            .unwrap();
        });
        let client = reqwest::Client::new();
        let q = Query {
            sequence: "ACGTACGT".into(),
            program: "blastn".into(),
            database: "core_nt".into(),
            email: String::new(),
        };
        assert_eq!(
            submit_to(&client, &format!("http://{address}"), &q)
                .await
                .unwrap()
                .rid,
            "SYNTHETIC123"
        );
        server.await.unwrap();
        assert!(submit_to(&client, &format!("http://{address}"), &q)
            .await
            .unwrap_err()
            .contains("internet"));
    }
}
