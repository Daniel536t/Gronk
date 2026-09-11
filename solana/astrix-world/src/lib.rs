//! ASTrix world clock — the metronome, not the simulation.
//!
//! This program owns exactly one fact: WHAT DAY IT IS on a persistent world
//! account. It contains no season logic, no crop logic, no starvation logic,
//! no population logic, no governance logic. Those live exclusively in ASTrix
//! Core, which observes this counter and advances its own simulation to match.
//!
//! Architectural law: the clock determines WHEN a transition occurs;
//! ASTrix Core determines WHAT that transition means.
//!
//! Instructions:
//!   0 - Initialize { authority: Pubkey }: create the world account (PDA
//!       seeds ["astrix-world"]), day = 1. One-time.
//!   1 - AdvanceDay: day += 1. Requires the authority signature (operator
//!       metronome for the slice-1 demo; crank-scheduled advance later).
//!       Deliberately privilege-free otherwise: advancing a counter needs no
//!       discretion, and abusing it only fast-forwards time in public.
//!   2 - DelegateWorld { commit_frequency_ms: u32, validator: Option<Pubkey> }:
//!       Delegate via the OFFICIAL ephemeral-rollups-sdk (`delegate_account`),
//!       which performs the sanctioned lifecycle a hand-rolled CPI misses:
//!       create buffer PDA, copy data, zero the PDA, reassign via the system
//!       program path, then CPI the delegation program. Direct approaches
//!       fail: a hand-built delegate CPI skips preparation (InvalidAccountOwner),
//!       and a direct owner `assign` trips the runtime guard (ModifiedProgramId).
//!       The world PDA signs through THESE seeds, which is why delegation must
//!       be authorized here rather than client-side. No simulation moves.
//!
//!   3 - PrepareDelegate: REMOVED (was a wrong theory: direct `assign` trips
//!       ModifiedProgramId; the SDK path above is the sanctioned lifecycle).
//!       Dispatch arm kept reserved; any call fails cleanly.
//!
//!   4 - CommitWorld: schedule a commit of the world account back to base via
//!       MagicIntentBundleBuilder. Anyone may call it (payer signs); it moves
//!       no semantics, only flushes ER state to Solana. Submit on the ER.
//!
//!   5 - CrankAdvance: permissionless day += 1 for crank-scheduled execution.
//!       Same semantic as AdvanceDay, no authority check: the counter is a
//!       public metronome (abuse only fast-forwards public time; Core owns
//!       all meaning). Scheduled instructions run top-level without inherited
//!       signatures, so gating this on a signer would silently break cranks.
//!       Accounts: world only.
//!
//!   6 - ScheduleHeartbeat { task_id: u64, interval_ms: u64, iterations: u64 }:
//!       CPI the crank scheduler (ScheduleCrankCpi) to run CrankAdvance on
//!       this world at the given cadence. Submitted ONCE on base; MagicBlock
//!       executes autonomously thereafter. Payer funds scheduling.

use borsh::{BorshDeserialize, BorshSerialize};
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use magicblock_magic_program_api::args::ScheduleTaskArgs;
use ephemeral_rollups_sdk::ephem::{FoldableIntentBuilder, MagicIntentBundleBuilder};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::Sysvar,
};
use solana_system_interface::instruction as system_instruction;

solana_program::declare_id!("qWpJE9ePjD8YnzW2AA6UdpFodF7LS7w5Y5CUmHArWK3");

const SEED: &[u8] = b"astrix-world";
const VERSION: u8 = 1;
const DELEGATION_PROGRAM_ID_STR: &str = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

#[derive(BorshSerialize, BorshDeserialize, Debug, PartialEq)]
pub struct World {
    pub version: u8,
    pub authority: Pubkey,
    pub day: u64,
    pub bump: u8,
}

impl World {
    pub const LEN: usize = 1 + 32 + 8 + 1;
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    input: &[u8],
) -> ProgramResult {
    let (tag, rest) = input.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match tag {
        0 => initialize(program_id, accounts, rest),
        1 => advance_day(program_id, accounts),
        2 => delegate_world(program_id, accounts, rest),
        3 => prepare_delegate(program_id, accounts),
        4 => commit_world(accounts),
        5 => crank_advance(program_id, accounts),
        6 => schedule_heartbeat(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

fn world_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[SEED], program_id)
}

fn load_world(world: &AccountInfo, program_id: &Pubkey) -> Result<World, ProgramError> {
    let (expected, _bump) = world_pda(program_id);
    if world.key != &expected {
        msg!("wrong world account");
        return Err(ProgramError::InvalidSeeds);
    }
    if world.owner != program_id {
        msg!("world account not owned by program");
        return Err(ProgramError::IllegalOwner);
    }
    let state = World::try_from_slice(&world.data.borrow()).map_err(|_| ProgramError::InvalidAccountData)?;
    if state.version != VERSION {
        msg!("unsupported version");
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(state)
}

fn initialize(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let world = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;
    if rest.len() != 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let authority = Pubkey::new_from_array(rest.try_into().unwrap());
    let (expected, bump) = world_pda(program_id);
    if world.key != &expected {
        return Err(ProgramError::InvalidSeeds);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if !world.data_is_empty() {
        msg!("already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(World::LEN);
    solana_program::program::invoke_signed(
        &system_instruction::create_account(
            payer.key,
            world.key,
            lamports,
            World::LEN as u64,
            program_id,
        ),
        &[payer.clone(), world.clone(), system_program.clone()],
        &[&[SEED, &[bump]]],
    )?;
    let state = World { version: VERSION, authority, day: 1, bump };
    state.serialize(&mut &mut world.data.borrow_mut()[..])?;
    msg!("astrix world initialized, day 1");
    Ok(())
}

fn advance_day(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let authority = next_account_info(iter)?;
    let world = next_account_info(iter)?;
    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let mut state = load_world(world, program_id)?;
    if authority.key != &state.authority {
        msg!("not the world authority");
        return Err(ProgramError::MissingRequiredSignature);
    }
    state.day = state.day.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    state.serialize(&mut &mut world.data.borrow_mut()[..])?;
    msg!("astrix world advanced to day {}", state.day);
    Ok(())
}

/// Delegate the world account to an Ephemeral Rollup via MagicBlock's
/// Delegation Program. Layout mirrors the official JS SDK
/// (createDelegateInstruction): the world PDA signs through THESE seeds,
/// which is why this CPI must live in the owner program.
///
/// Accounts: authority/payer (signer, writable), world (writable, PDA
/// signer), owner program = self (readonly), delegate buffer (writable),
/// delegation record (writable), delegation metadata (writable), delegation
/// program (readonly), system program (readonly).
/// Data: [2, commit_frequency_ms: u32 LE, validator: Option<Pubkey> as
/// 0x00 | (0x01 + 32 bytes)].
fn delegate_world(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let world = next_account_info(iter)?;
    let owner_program = next_account_info(iter)?;
    let buffer = next_account_info(iter)?;
    let record = next_account_info(iter)?;
    let metadata = next_account_info(iter)?;
    let delegation_program = next_account_info(iter)?;
    let system_program = next_account_info(iter)?;
    if rest.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if owner_program.key != program_id {
        msg!("owner program mismatch");
        return Err(ProgramError::IncorrectProgramId);
    }
    let expected_delegation: Pubkey = DELEGATION_PROGRAM_ID_STR
        .parse()
        .map_err(|_| ProgramError::IncorrectProgramId)?;
    if delegation_program.key != &expected_delegation {
        msg!("not the delegation program");
        return Err(ProgramError::IncorrectProgramId);
    }
    let commit_frequency_ms = u32::from_le_bytes(rest[0..4].try_into().unwrap());
    let validator: Option<Pubkey> = match rest[4] {
        0 => None,
        1 => {
            if rest.len() < 5 + 32 {
                return Err(ProgramError::InvalidInstructionData);
            }
            Some(Pubkey::new_from_array(rest[5..37].try_into().unwrap()))
        }
        _ => return Err(ProgramError::InvalidInstructionData),
    };
    let (expected_world, _bump) = world_pda(program_id);
    if world.key != &expected_world {
        return Err(ProgramError::InvalidSeeds);
    }
    // Sanctioned lifecycle via the official SDK: buffer create + data copy +
    // zeroing + system-path reassignment + delegation CPI. The SDK signs the
    // PDA through our seeds; our checks above (payer signer, owner program,
    // delegation program, world PDA) are the ASTrix-side authorization.
    delegate_account(
        DelegateAccounts {
            payer,
            pda: world,
            owner_program,
            buffer: buffer,
            delegation_record: record,
            delegation_metadata: metadata,
            delegation_program,
            system_program,
        },
        &[SEED],
        DelegateConfig { commit_frequency_ms, validator },
    )
    .map_err(|_| ProgramError::Custom(0xA0))?;
    msg!("astrix world delegated");
    Ok(())
}

/// Schedule a commit of the world account back to base layer.
/// Accounts: payer (signer), world (writable), magic_context, magic_program.
/// Anyone may flush; flushing moves no semantics.
fn commit_world(accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let payer = next_account_info(iter)?;
    let world = next_account_info(iter)?;
    let magic_context = next_account_info(iter)?;
    let magic_program = next_account_info(iter)?;
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    MagicIntentBundleBuilder::new(payer.clone(), magic_context.clone(), magic_program.clone())
        .commit(&[world.clone()])
        .build_and_invoke()
        .map_err(|_| ProgramError::Custom(0xA1))?;
    msg!("astrix world commit scheduled");
    Ok(())
}

/// Permissionless advance for crank execution (see header).
/// Accounts: world (writable) only.
fn crank_advance(program_id: &Pubkey, accounts: &[AccountInfo]) -> ProgramResult {
    let iter = &mut accounts.iter();
    let world = next_account_info(iter)?;
    let mut state = load_world(world, program_id)?;
    state.day = state.day.checked_add(1).ok_or(ProgramError::ArithmeticOverflow)?;
    state.serialize(&mut &mut world.data.borrow_mut()[..])?;
    msg!("astrix world crank-advanced to day {}", state.day);
    Ok(())
}

/// Schedule autonomous heartbeat ticks via the crank scheduler.
/// Accounts: payer (signer, writable), world (writable), magic_program.
/// Data: [6, task_id: u64 LE, interval_ms: u64 LE, iterations: u64 LE].
/// Submitted once on BASE; the validator then executes CrankAdvance on the
/// ER at the cadence, no further signatures needed.
fn schedule_heartbeat(program_id: &Pubkey, accounts: &[AccountInfo], rest: &[u8]) -> ProgramResult {
    let payer = &accounts[0];
    let world = &accounts[1];
    let magic_program = &accounts[2];
    if accounts.len() < 3 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    if rest.len() < 24 {
        return Err(ProgramError::InvalidInstructionData);
    }
    if !payer.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }
    let (expected_world, _bump) = world_pda(program_id);
    if world.key != &expected_world {
        return Err(ProgramError::InvalidSeeds);
    }
    let task_id = u64::from_le_bytes(rest[0..8].try_into().unwrap());
    let interval_ms = u64::from_le_bytes(rest[8..16].try_into().unwrap());
    let iterations = u64::from_le_bytes(rest[16..24].try_into().unwrap());
    if iterations == 0 || iterations > 1000 {
        return Err(ProgramError::InvalidArgument);
    }
    let advance_ix = solana_program::instruction::Instruction {
        program_id: *program_id,
        accounts: vec![solana_program::instruction::AccountMeta::new(*world.key, false)],
        data: vec![5u8],
    };
    // Same bytes ScheduleCrankCpi would build (checked against its source):
    // payer + instruction accounts, bincode(ScheduleTask{...}) to magic program.
    let schedule_ix = solana_program::instruction::Instruction::new_with_bincode(
        *magic_program.key,
        &magicblock_magic_program_api::instruction::MagicBlockInstruction::ScheduleTask(
            magicblock_magic_program_api::args::ScheduleTaskArgs {
                task_id: task_id as i64,
                execution_interval_millis: interval_ms as i64,
                iterations: iterations as i64,
                instructions: vec![advance_ix],
            },
        ),
        vec![
            solana_program::instruction::AccountMeta::new(*payer.key, true),
            solana_program::instruction::AccountMeta::new(*world.key, false),
        ],
    );
    solana_program::program::invoke(
        &schedule_ix,
        &[payer.clone(), world.clone(), magic_program.clone()],
    )?;
    msg!("astrix heartbeat scheduled: {} ticks every {}ms", iterations, interval_ms);
    Ok(())
}

/// Reserved (was a wrong theory: direct `assign` trips ModifiedProgramId).
/// Any call fails cleanly; the SDK path in `delegate_world` is the lifecycle.
fn prepare_delegate(_program_id: &Pubkey, _accounts: &[AccountInfo]) -> ProgramResult {
    msg!("prepare_delegate retired: use delegate_world");
    Err(ProgramError::InvalidInstructionData)
}

/// Reassign world ownership to the Delegation Program (pre-step the deployed
/// delegation flow expects before `delegate` finalizes).
/// Accounts: authority (signer), world (writable PDA).
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_state_roundtrips() {
        let w = World { version: 1, authority: Pubkey::new_unique(), day: 41, bump: 3 };
        let mut buf = vec![0u8; World::LEN];
        w.serialize(&mut &mut buf[..]).unwrap();
        assert_eq!(World::try_from_slice(&buf).unwrap(), w);
    }

    #[test]
    fn day_math_cannot_wrap() {
        assert!(u64::MAX.checked_add(1).is_none());
    }
}
