use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
};

pub(super) const MAX_JSON_BYTES: usize = 1024 * 1024;

pub(super) struct InputPaths {
    pub(super) candidate_evidence: PathBuf,
    pub(super) plan: Option<PathBuf>,
}

pub(super) fn input_paths() -> Result<InputPaths, String> {
    parse_input_paths(std::env::args_os().skip(1))
}

fn parse_input_paths<I, S>(arguments: I) -> Result<InputPaths, String>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString>,
{
    let arguments = arguments.into_iter().map(Into::into).collect::<Vec<_>>();
    if arguments.len() % 2 != 0 {
        return Err("every option requires a non-secret JSON path".into());
    }
    let mut candidate_evidence = None;
    let mut plan = None;
    for pair in arguments.chunks_exact(2) {
        record_input_path(pair, &mut candidate_evidence, &mut plan)?;
    }
    Ok(InputPaths {
        candidate_evidence: candidate_evidence
            .ok_or_else(|| "--candidate-evidence is required".to_owned())?,
        plan,
    })
}

fn record_input_path(
    pair: &[std::ffi::OsString],
    candidate_evidence: &mut Option<PathBuf>,
    plan: &mut Option<PathBuf>,
) -> Result<(), String> {
    match pair[0].to_str() {
        Some("--candidate-evidence") if candidate_evidence.is_none() => {
            *candidate_evidence = Some(absolute_input_path(&pair[1])?);
            Ok(())
        }
        Some("--plan") if plan.is_none() => {
            *plan = Some(absolute_input_path(&pair[1])?);
            Ok(())
        }
        _ => Err("only --candidate-evidence and --plan may be supplied once".into()),
    }
}

fn absolute_input_path(value: &std::ffi::OsString) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    path.is_absolute()
        .then_some(path)
        .ok_or_else(|| "qualification input paths must be absolute".into())
}

pub(super) fn read_bounded_regular(
    path: &Path,
    label: &str,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let file = open_regular_input(path, label, maximum)?;
    read_open_bounded_regular(file, label, maximum)
}

fn open_regular_input(path: &Path, label: &str, maximum: usize) -> Result<fs::File, String> {
    let file = open_input_without_following(path).map_err(|_| format!("{label} is unavailable"))?;
    let metadata = file
        .metadata()
        .map_err(|_| format!("{label} is unreadable"))?;
    if !metadata.is_file() || input_handle_is_reparse_point(&metadata) {
        return Err(format!("{label} must be a regular non-symlink file"));
    }
    if metadata.len() > maximum as u64 {
        return Err(format!("{label} exceeds its size limit"));
    }
    Ok(file)
}

fn read_open_bounded_regular(
    file: fs::File,
    label: &str,
    maximum: usize,
) -> Result<Vec<u8>, String> {
    let capacity = usize::try_from(
        file.metadata()
            .map_err(|_| format!("{label} is unreadable"))?
            .len(),
    )
    .map_err(|_| format!("{label} exceeds its size limit"))?;
    let mut bytes = Vec::with_capacity(capacity.min(maximum));
    let mut reader = file.take(maximum as u64 + 1);
    reader
        .read_to_end(&mut bytes)
        .map_err(|_| format!("{label} is unreadable"))?;
    if bytes.len() > maximum {
        return Err(format!("{label} exceeds its size limit"));
    }
    Ok(bytes)
}

#[cfg(windows)]
fn open_input_without_following(path: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;

    // Keep the handle as the sole byte source. Opening the final path as the
    // reparse object and denying write/delete sharing makes substitutions fail
    // closed instead of resolving a symlink/reparse point or swapping files.
    fs::OpenOptions::new()
        .read(true)
        .share_mode(0x0000_0001) // FILE_SHARE_READ
        .custom_flags(0x0020_0000) // FILE_FLAG_OPEN_REPARSE_POINT
        .open(path)
}

#[cfg(windows)]
fn input_handle_is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt as _;

    metadata.file_attributes() & 0x0000_0400 != 0 // FILE_ATTRIBUTE_REPARSE_POINT
}

#[cfg(unix)]
fn open_input_without_following(path: &Path) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;

    fs::OpenOptions::new()
        .read(true)
        .custom_flags(unix_no_follow_nonblocking_flags())
        .open(path)
}

#[cfg(unix)]
fn input_handle_is_reparse_point(_: &fs::Metadata) -> bool {
    false
}

#[cfg(target_os = "linux")]
const fn unix_no_follow_nonblocking_flags() -> i32 {
    0x0002_0000 | 0x0000_0800 // O_NOFOLLOW | O_NONBLOCK
}

#[cfg(any(
    target_os = "macos",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
const fn unix_no_follow_nonblocking_flags() -> i32 {
    0x0000_0100 | 0x0000_0004 // O_NOFOLLOW | O_NONBLOCK
}

#[cfg(test)]
mod tests {
    use super::{
        open_regular_input, parse_input_paths, read_bounded_regular, read_open_bounded_regular,
        InputPaths, MAX_JSON_BYTES,
    };
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::{fs, path::PathBuf};

    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_directory() -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "appport-qualification-input-{}-{suffix}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&directory).unwrap();
        directory
    }

    fn parse(arguments: Vec<std::ffi::OsString>) -> Result<InputPaths, String> {
        parse_input_paths(arguments)
    }

    #[test]
    fn input_grammar_requires_only_absolute_unique_paths() {
        let absolute = std::env::temp_dir().join("candidate-evidence.json");
        let valid = parse(vec![
            "--candidate-evidence".into(),
            absolute.clone().into_os_string(),
            "--plan".into(),
            absolute.clone().into_os_string(),
        ])
        .unwrap();
        assert_eq!(valid.candidate_evidence, absolute);
        assert_eq!(valid.plan, Some(absolute));

        for arguments in [
            vec!["--candidate-evidence".into()],
            vec!["--unknown".into(), "/candidate.json".into()],
            vec!["--candidate-evidence".into(), "candidate.json".into()],
            vec![
                "--candidate-evidence".into(),
                "/candidate.json".into(),
                "--candidate-evidence".into(),
                "/second.json".into(),
            ],
        ] {
            assert!(parse(arguments).is_err());
        }
    }

    #[test]
    fn bounded_reader_accepts_a_valid_regular_file() {
        let directory = test_directory();
        let input = directory.join("candidate.json");
        fs::write(&input, br#"{"schemaVersion":5}"#).unwrap();

        assert_eq!(
            read_bounded_regular(&input, "candidate evidence", MAX_JSON_BYTES).unwrap(),
            br#"{"schemaVersion":5}"#
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bounded_reader_rejects_oversized_and_non_regular_inputs() {
        let directory = test_directory();
        let oversized = directory.join("oversized.json");
        fs::write(&oversized, vec![b'x'; MAX_JSON_BYTES + 1]).unwrap();

        assert!(read_bounded_regular(&oversized, "candidate evidence", MAX_JSON_BYTES).is_err());
        assert!(read_bounded_regular(&directory, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn bounded_reader_rejects_a_final_symlink() {
        use std::os::unix::fs::symlink;

        let directory = test_directory();
        let target = directory.join("target.json");
        let link = directory.join("candidate.json");
        fs::write(&target, b"trusted").unwrap();
        symlink(&target, &link).unwrap();

        assert!(read_bounded_regular(&link, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn bounded_reader_rejects_a_final_reparse_point() {
        use std::os::windows::fs::symlink_file;
        use windows::Win32::Foundation::ERROR_PRIVILEGE_NOT_HELD;

        let directory = test_directory();
        let target = directory.join("target.json");
        let link = directory.join("candidate.json");
        fs::write(&target, b"trusted").unwrap();
        match symlink_file(&target, &link) {
            Ok(()) => {}
            Err(error) if error.raw_os_error() == Some(ERROR_PRIVILEGE_NOT_HELD.0 as i32) => {
                fs::remove_dir_all(directory).unwrap();
                return;
            }
            Err(error) => panic!("failed to create test symlink: {error}"),
        }

        assert!(read_bounded_regular(&link, "candidate evidence", MAX_JSON_BYTES).is_err());
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn opened_handle_cannot_be_redirected_by_a_path_replacement() {
        let directory = test_directory();
        let input = directory.join("candidate.json");
        let replacement = directory.join("replacement.json");
        fs::write(&input, b"original").unwrap();
        fs::write(&replacement, b"replacement").unwrap();

        let file = open_regular_input(&input, "candidate evidence", MAX_JSON_BYTES).unwrap();
        fs::rename(&replacement, &input).unwrap();
        assert_eq!(
            read_open_bounded_regular(file, "candidate evidence", MAX_JSON_BYTES).unwrap(),
            b"original"
        );
        fs::remove_dir_all(directory).unwrap();
    }
}
